/* THE RENDER AUDIT — what a farmer's browser actually gets.
 * ===========================================================================
 *
 *     node scripts/audit-site.mjs                 the default page set
 *     node scripts/audit-site.mjs --all           every URL in sitemap.xml
 *     node scripts/audit-site.mjs --base http://localhost:8080
 *     node scripts/audit-site.mjs --page /cash-bids --page /elevators
 *
 * WHY THIS EXISTS, IN ONE DAY'S WORTH OF EVIDENCE
 *
 * 2026-09-05 shipped four defects. Every one passed every check in this
 * repository, and every one was obvious the moment a person looked at the page:
 *
 *   /elevators      the basemap style was `dark_matter`, which is a 404. The
 *                   map drew 4,581 dots on a black void for a day. The checks
 *                   counted markers and asserted the map object existed; not
 *                   one asked whether a tile had loaded.
 *   /sponsor-report the "not started" card used two CSS variables that do not
 *                   exist, so a near-white panel carried the dark theme's light
 *                   text. 27 guards passed. None could read.
 *   /               the bid network shipped and nothing on the homepage said
 *                   so. The word "changelog" appeared zero times.
 *   the sponsor ad  the homepage card and the email block read different key
 *                   names, so a paid ad would have run in the briefing while
 *                   the homepage showed "Available" — and the sponsor's own
 *                   report would have read zero.
 *
 * The pattern is one thing: STATIC CHECKS READ CODE, AND CODE IS NOT WHAT A
 * FARMER GETS. A grep cannot see a 404 tile, a contrast ratio, a number that
 * never arrived, or a panel that stayed hidden.
 *
 * WHY IT RUNS IN ACTIONS AND NOT IN A CHAT SESSION
 *
 * The sandbox those checks were written in cannot reach agsist.com, cdnjs, or
 * the tile host — every one is refused at the proxy. So Leaflet was `undefined`
 * in every "render check" of the map, and the map never initialised at all.
 * Those checks were reported as passing. They were not testing the thing.
 *
 * A GitHub runner has open egress. So this belongs in the repository, on a
 * schedule, where it does not depend on anybody being in a conversation.
 *
 * WHAT IT CANNOT DO. It does not know what the numbers should be — rule 8 says
 * measure, and this measures what the page did, not whether the agronomy is
 * right. It will not catch a wrong price. It catches a page that is broken,
 * unreadable, empty, or lying about being loaded.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BASE = (arg("--base", "https://agsist.com")).replace(/\/$/, "");
const ONLY = argv.reduce((a, v, i) => (v === "--page" ? a.concat(argv[i + 1]) : a), []);

/* The pages worth rendering every day. Not all 535 — the state and county
   pages are generated from one template, so rendering ten of them proves the
   same thing ten times while making the report too long to read. --all exists
   for when the template itself changes. */
const DEFAULT_PAGES = [
  "/", "/cash-bids", "/elevators", "/hail-map", "/daily", "/markets",
  "/basis", "/spray", "/urea", "/changelog", "/status", "/sponsor",
  "/corn-futures-prices", "/soybean-futures-prices", "/breakeven", "/tools",
];
/* /sponsor-report is deliberately NOT here. It renders nothing without the
   ?r= token in the link, so it would report as an empty page every run — and
   the token is a sponsor's private link, which does not belong in a file in a
   public repository. Audit it by hand with --page "/sponsor-report?r=..." */

function sitemapPages() {
  const f = ROOT + "sitemap.xml";
  if (!existsSync(f)) return DEFAULT_PAGES;
  return [...readFileSync(f, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].replace(/^https?:\/\/[^/]+/, "") || "/");
}

const PAGES = ONLY.length ? ONLY : argv.includes("--all") ? sitemapPages() : DEFAULT_PAGES;

/* WCAG relative luminance. Contrast is arithmetic, not taste — the sponsor
   card looked fine to me in a file and was 1.1:1 on the screen. */
const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + 0.05) / (l + 0.05); };
const rgb = (s) => { const m = (s || "").match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };

/* Text that means "this never arrived". An em dash alone is a legitimate
   placeholder in this site's tables, so it is only a finding when a whole
   block is nothing but placeholders. */
const DEAD_TEXT = [/\bundefined\b/, /\bNaN\b/, /\bnull\b/, /\[object Object\]/,
                   /Failed to fetch/i, /Loading[.…]{1,3}$/];

const findings = [];
const add = (page, sev, kind, detail) => findings.push({ page, sev, kind, detail });

const browser = await chromium.launch();
const started = Date.now();

for (const path of PAGES) {
  const url = BASE + path;
  for (const [device, width, height] of [["desktop", 1400, 900], ["mobile", 390, 780]]) {
    const ctx = await browser.newContext({ viewport: { width, height },
      userAgent: "AGSIST-audit/1.0 (+https://agsist.com; sig@farmers1st.com)" });
    const page = await ctx.newPage();

    const errors = [], badRes = [], deadRes = [];
    page.on("pageerror", (e) => errors.push(String(e).split("\n")[0].slice(0, 160)));
    page.on("response", (r) => {
      const s = r.status();
      /* THE CHECK THAT WOULD HAVE CAUGHT THE MAP. Every subresource the page
         asked for, and what it got back. A 404 tile is invisible on screen
         and unmissable here. */
      if (s >= 400) badRes.push(s + "  " + r.url().replace(BASE, "").slice(0, 110));
    });
    /* A REQUEST THAT NEVER CONNECTED IS AS BROKEN AS A 404, AND IT FIRES A
       DIFFERENT EVENT. `response` never runs for a DNS failure, a refused
       connection or a proxy block, so a page whose map library never loaded
       would have passed the check above in silence — which is precisely how
       the /elevators map went a day without anyone noticing that Leaflet
       itself was absent in the environment the checks ran in. */
    page.on("requestfailed", (r) => {
      const why = (r.failure() || {}).errorText || "failed";
      if (/ERR_ABORTED/.test(why)) return;      /* navigation cancels, not faults */
      deadRes.push(why + "  " + r.url().replace(BASE, "").slice(0, 100));
    });

    let status = 0;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = resp ? resp.status() : 0;
      /* Give the data fetches, the map tiles and the injected chrome time to
         land. This site paints from JSON after load; auditing at
         domcontentloaded alone would audit an empty shell. */
      await page.waitForTimeout(6000);
    } catch (e) {
      add(path, "high", "unreachable", device + ": " + String(e).split("\n")[0].slice(0, 130));
      await ctx.close();
      continue;
    }

    if (status !== 200) add(path, "high", "http", device + ": returned " + status);

    for (const e of [...new Set(errors)])
      add(path, "high", "js-error", device + ": " + e);

    /* Deduplicate by URL: one broken tile style produces hundreds of 404s and
       they are all the same fault. */
    const uniqRes = [...new Set(badRes.map((b) => b.replace(/\/\d+\/\d+\/\d+(@2x)?\.png$/, "/{z}/{x}/{y}.png")))];
    for (const r of uniqRes.slice(0, 6))
      add(path, "high", "subresource", device + ": " + r +
        (uniqRes.length > 6 ? "  (+" + (uniqRes.length - 6) + " more)" : ""));

    const uniqDead = [...new Set(deadRes.map((b) => b.replace(/\/\d+\/\d+\/\d+(@2x)?\.png$/, "/{z}/{x}/{y}.png")))];
    for (const r of uniqDead.slice(0, 4))
      add(path, "high", "no-connect", device + ": " + r +
        (uniqDead.length > 4 ? "  (+" + (uniqDead.length - 4) + " more)" : ""));

    const measured = await page.evaluate((vw) => {
      const out = { overflow: [], dead: [], lowContrast: [], emptyBlocks: [], title: document.title };
      /* Horizontal scroll: the one layout fault a phone actually suffers. */
      if (document.documentElement.scrollWidth > vw + 1) {
        for (const el of document.querySelectorAll("body *")) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          if (b.right <= vw + 1) continue;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          let a = el.parentElement, clipped = false;
          while (a) { const s = getComputedStyle(a);
            if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflow)) { clipped = true; break; } a = a.parentElement; }
          if (clipped) continue;
          out.overflow.push((el.tagName.toLowerCase()) + (el.id ? "#" + el.id : "") +
            (el.className && el.className.toString ? "." + el.className.toString().trim().split(/\s+/)[0] : "") +
            " right:" + Math.round(b.right));
          if (out.overflow.length > 3) break;
        }
        if (!out.overflow.length) out.overflow.push("document " + document.documentElement.scrollWidth + " > viewport " + vw);
      }
      /* Text that means a fetch failed or a template did not fill. */
      const body = (document.body.innerText || "");
      out.bodyLen = body.length;
      out.sample = body.replace(/\s+/g, " ").slice(0, 120);
      /* Sections that rendered a heading and nothing else. */
      for (const sec of document.querySelectorAll("section, .card, .panel")) {
        const t = (sec.innerText || "").replace(/\s+/g, " ").trim();
        if (t.length && t.length < 3) out.emptyBlocks.push((sec.id || sec.className || "section").toString().slice(0, 40));
      }
      /* Contrast on real, visible prose. Sampled rather than exhaustive: the
         point is to catch a block nobody can read, not to grade every span. */
      const seen = new Set();
      for (const el of document.querySelectorAll("p, li, h1, h2, h3, dd, .sr-pending, .bidnet-txt, td")) {
        if (out.lowContrast.length >= 4) break;
        const txt = (el.innerText || "").trim();
        if (txt.length < 12) continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || b.top > 4000) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.opacity === "0") continue;
        let bg = cs.backgroundColor, node = el;
        while (bg === "rgba(0, 0, 0, 0)" && node.parentElement) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
        const key = cs.color + "|" + bg;
        if (seen.has(key)) continue;
        seen.add(key);
        out.lowContrast.push({ fg: cs.color, bg, txt: txt.slice(0, 46) });
      }
      return out;
    }, width);

    for (const o of measured.overflow)
      add(path, device === "mobile" ? "high" : "med", "overflow", device + ": " + o);

    if (measured.bodyLen < 400)
      add(path, "high", "empty", device + ": rendered only " + measured.bodyLen +
        " chars of text — \"" + measured.sample + "\"");

    for (const d of DEAD_TEXT)
      if (d.test(measured.sample))
        add(path, "high", "dead-text", device + ": visible \"" + measured.sample.match(d)[0] + "\"");

    for (const c of measured.lowContrast) {
      const f = rgb(c.fg), b = rgb(c.bg);
      if (!f || !b) continue;
      const r = contrast(f, b);
      if (r < 4.5) add(path, r < 3 ? "high" : "med", "contrast",
        device + ": " + r.toFixed(2) + ":1 on \"" + c.txt + "\" (" + c.fg + " on " + c.bg + ")");
    }

    if (device === "desktop" && !measured.title)
      add(path, "med", "seo", "no <title>");

    await ctx.close();
  }
}

await browser.close();

/* ═══════════════════════════════════════════════════════════════════════════
 *  IS IT THE SITE, OR IS IT THIS MACHINE?
 * ═══════════════════════════════════════════════════════════════════════════
 *  Run behind an egress proxy, every external host fails and the report is
 *  sixteen HIGH findings that all say the same thing about the network rather
 *  than anything about the site. That is the shape of a guard nobody reads.
 *
 *  So: if several DIFFERENT third-party hosts all fail to connect, that is the
 *  environment, and it is reported once, as one finding, with the verdict that
 *  the run proves nothing. A single host failing is still the site's problem
 *  and stays.
 *
 *  This is not cosmetic. The whole reason /elevators shipped without a basemap
 *  is that its checks ran somewhere Leaflet could not load, and nothing said
 *  so. An audit that cannot reach the internet must announce that loudly
 *  instead of producing a confident list.
 */
{
  const dead = findings.filter((f) => f.kind === "no-connect");
  const hosts = new Set();
  for (const f of dead) {
    const m = f.detail.match(/https?:\/\/([^/\s]+)/);
    if (m) hosts.add(m[1]);
  }
  const external = [...hosts].filter((h) => !BASE.includes(h));
  if (external.length >= 3) {
    for (let i = findings.length - 1; i >= 0; i--)
      if (findings[i].kind === "no-connect") findings.splice(i, 1);
    findings.push({
      page: "(environment)", sev: "high", kind: "no-egress",
      detail: external.length + " third-party hosts unreachable (" +
        external.slice(0, 4).join(", ") + (external.length > 4 ? ", …" : "") +
        "). This machine cannot reach the internet, so THIS RUN PROVES NOTHING " +
        "about the site. Run it on a GitHub runner, or anywhere with open egress.",
    });
  }
}

const order = { high: 0, med: 1, low: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.page.localeCompare(b.page));
const counts = findings.reduce((a, f) => (a[f.sev] = (a[f.sev] || 0) + 1, a), {});
const secs = Math.round((Date.now() - started) / 1000);

console.log("\nRENDER AUDIT — " + BASE);
console.log(PAGES.length + " pages, desktop + mobile, " + secs + "s\n");
if (!findings.length) console.log("  nothing found\n");
let last = "";
for (const f of findings) {
  if (f.page !== last) { console.log("  " + f.page); last = f.page; }
  console.log("    [" + f.sev.toUpperCase().padEnd(4) + "] " + f.kind.padEnd(12) + f.detail);
}
console.log("\n  high " + (counts.high || 0) + "   med " + (counts.med || 0) + "\n");

/* Committed so the trend exists. A single audit says what is broken today; a
   file in git says whether the site is getting better. */
try {
  mkdirSync(ROOT + "data", { recursive: true });
  writeFileSync(ROOT + "data/audit.json", JSON.stringify({
    schema: "agsist-render-audit/1", base: BASE,
    ran: new Date().toISOString(), pages: PAGES.length, seconds: secs,
    high: counts.high || 0, med: counts.med || 0, findings,
  }, null, 1) + "\n");
} catch (e) { console.log("  (could not write data/audit.json: " + e.message + ")"); }

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = findings.slice(0, 60).map((f) =>
    "| " + f.sev + " | " + f.page + " | " + f.kind + " | " + f.detail.replace(/\|/g, "\\|") + " |").join("\n");
  writeFileSync(process.env.GITHUB_STEP_SUMMARY,
    "### Render audit — " + PAGES.length + " pages\n\n" +
    "**high " + (counts.high || 0) + " · med " + (counts.med || 0) + "**\n\n" +
    (findings.length ? "| sev | page | kind | detail |\n|---|---|---|---|\n" + rows
                     : "Nothing found.") + "\n", { flag: "a" });
}

/* Only `high` fails the run. A medium finding is worth reading and is not
   worth a red tick that trains everybody to ignore red ticks. */
process.exit((counts.high || 0) > 0 ? 1 : 0);
