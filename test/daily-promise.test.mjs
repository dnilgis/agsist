/* What the site promises about AGSIST Daily (Sig, 2026-10-19).
 *
 *   1. The Daily is described as "every morning", with no clock time. It goes
 *      out seven days a week and weekend sends have landed after 9 am, so no
 *      page, component or page builder may say "every weekday", "weekday
 *      morning", "by 6am CT" or any other clock time about it.
 *   2. No email ask pre-ticks "also send me the Daily": no checkbox that
 *      signs a reader up for the Daily starts checked, and no data-daily="on"
 *      is left to ask for one.
 *
 * Scanned: every tracked .html page (except the dated issues under daily/,
 * whose datelines are facts about one issue), components/*.js and *.html,
 * the Next block data, the changelog data, and the builders that write page
 * copy. Comments are skipped; only text a reader can see or a builder writes
 * is checked. True clock facts that are not about the Daily (USDA release
 * times, bid stamps, trading hours) never sit in a sentence about the Daily
 * or its inbox, so they pass.
 *
 *   node --test test/daily-promise.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const BUILDERS = [
  "scripts/dev/nav/gen_nav.py", "scripts/cash_bid_index.py", "scripts/build_share_images.py",
  "scripts/build_social_card.py", "scripts/generate_daily.py", "scripts/build_county_rain.py",
  "scripts/build_cash_bid_pages.py", "scripts/build_company_pages.py", "scripts/make_prf_html.py",
  "scripts/build_prf_counties.py", "scripts/build_next_links.py", "scripts/build_whats_new.py",
  "scripts/build_changelog.py", "scripts/build_atlas_pages.py", "scripts/build_state_rent_pages.py",
  "scripts/build_arc_plc.py", "scripts/critique_briefing.py",
];

function files() {
  const all = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean);
  const out = all.filter((f) =>
    (f.endsWith(".html") && !/^daily\/\d{4}-/.test(f) && !f.startsWith("test/") && !f.startsWith(".claude/") && !f.startsWith("build/"))
    || /^components\/[^/]+\.js$/.test(f)
    || f === "data/next-links.json" || /^data\/next\/.+\.json$/.test(f)
    || f === "data/changelog.json" || f === "data/whats-new.json");
  return out.concat(BUILDERS);
}

/* The text a reader could see: comments out. */
function visible(f, s) {
  if (f.endsWith(".js") || f.endsWith(".mjs")) return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  if (f.endsWith(".py")) return s.replace(/^\s*#.*$/gm, " ");
  if (f.endsWith(".html")) return s.replace(/<!--[\s\S]*?-->/g, " ");
  return s;
}

const WEEKDAY = /\b(every|each)[\s\u00a0]+weekday\b|\bweekdays?[\s\u00a0]+mornings?\b|\bweekdays[\s\u00a0]+only\b|\bmon(day)?[\s\u00a0]*(-|to|through|thru)[\s\u00a0]*fri(day)?\b/i;
const CLOCK = /\b(1[0-2]|0?[1-9])(:[0-5]\d)?(\s|\u00a0|&nbsp;)?(am|a\.m\.)(?![a-z])/i;
/* "Daily" capitalized is the product; "vectorized daily" is not. */
const DAILY = /\bDaily\b|\b[Bb]riefing\b|\binbox\b|[Ss]ign ?up|[Ss]ubscrib|morning (farm )?markets/;

/* A short stretch of text: a text node, an attribute value or a string. */
function pieces(s) { return s.split(/[<>"`\n]|\\n|'(?=\s*[+,;)\]])|(?<=[(+,=\[]\s*)'/); }

export function weekdayFindings(f, s) {
  const bad = [];
  for (const p of pieces(visible(f, s))) {
    if (WEEKDAY.test(p) && (DAILY.test(p) || /email|markets|top local bid|\bfree\b/i.test(p))) bad.push(p.trim().slice(0, 160));
  }
  return bad;
}
export function clockFindings(f, s) {
  const bad = [];
  for (const p of pieces(visible(f, s))) {
    for (const sent of p.split(/(?<=[.!?])\s+/)) {
      if (CLOCK.test(sent) && DAILY.test(sent) && !/\b(release|released|USDA|NASS|WASDE|report)\b/i.test(sent)) bad.push(sent.trim().slice(0, 160));
    }
  }
  return bad;
}
/* A checkbox that starts checked with the Daily in its label. */
export function pretickFindings(f, s) {
  const bad = [];
  const v = visible(f, s);
  if (/data-daily=(["'])on\1|data-daily=\\?"on/.test(v)) bad.push('data-daily="on"');
  const re = /<input\b[^>]*type=\\?["']?checkbox[^>]*>/gi;
  let m;
  while ((m = re.exec(v))) {
    const tag = m[0], after = v.slice(re.lastIndex, re.lastIndex + 200).split(/<\/label>/i)[0];
    if (/\bchecked\b/.test(tag) && /\bdaily\b|morning briefing|every morning|each morning/i.test(after)) bad.push((tag + after).slice(0, 200));
  }
  return bad;
}

test("no page, component or builder promises the Daily on weekdays only", () => {
  const bad = [];
  for (const f of files()) for (const p of weekdayFindings(f, read(f))) bad.push(`${f}: ${p}`);
  assert.deepEqual(bad, [], "say every morning, not every weekday (Sig, 2026-10-19)");
});

test("no page, component or builder promises a clock time for the Daily", () => {
  const bad = [];
  for (const f of files()) for (const p of clockFindings(f, read(f))) bad.push(`${f}: ${p}`);
  assert.deepEqual(bad, [], "the Daily comes every morning, with no clock time (Sig, 2026-10-19)");
});

test("no ask pre-ticks the Daily box", () => {
  const bad = [];
  for (const f of files()) for (const p of pretickFindings(f, read(f))) bad.push(`${f}: ${p}`);
  assert.deepEqual(bad, [], "a Daily box starts empty; the reader ticks it (Sig, 2026-10-19)");
  const sa = read("components/signup-ask.js");
  assert.ok(!/getAttribute\('data-daily'\)/.test(sa), "signup-ask.js reads no attribute that ticks the box");
});

test("the guards catch the copies Sig asked to change (real Oct 19 cases)", () => {
  const W = (f, s) => weekdayFindings(f, s).length, C = (f, s) => clockFindings(f, s).length, T = (f, s) => pretickFindings(f, s).length;
  assert.equal(W("basis.html", '<div data-signup-ask="Email me my top local bid and the markets, every weekday morning" data-source="page:basis"></div>'), 1);
  assert.equal(W("cot.html", '<div data-signup-ask="Email me the morning farm markets and my top local bid, every weekday" data-source="page:cot"></div>'), 1);
  assert.equal(W("daily.html", '<meta property="og:image:alt"    content="Daily Ag Briefing. Grain markets before the open, free in your inbox every weekday.">'), 1);
  assert.equal(W("scripts/build_share_images.py", '    "daily": ("AGSIST Daily", "Grain markets before the open, free in your inbox every weekday."),'), 1);
  assert.equal(W("data/next-links.json", ' "ask": "Email me the markets and my top local bid, every weekday morning",'), 1);
  assert.equal(W("data/next-links.json", '     "why": "The markets in a few minutes, every weekday"'), 1);
  assert.equal(C("spray.html", '<p style="margin:0">Overnight markets, what to watch, and farm weather, by 6am\u00a0CT every morning. Available at no charge.</p>'), 0,
    "no Daily word in that sentence on its own; the card's title carries it");
  assert.equal(C("spray.html", "<div>AGSIST Daily arrives by 6am CT every morning. Check your spam folder once.</div>"), 1);
  assert.equal(C("cattle-futures-prices.html", '<div class="ra-n">Daily Briefing</div><div class="ra-d">Cattle read by 6am CT</div>'), 0,
    "split across two tags; covered by the literal check below");
  assert.equal(C("x.html", "<p>The briefing is written at 6:00 AM CT and the board moves all day.</p>"), 1);
  assert.equal(C("x.html", "<p>USDA releases the WASDE at 11 am CT; the Daily covers it the next morning.</p>"), 0, "a release time is a fact, not a promise");
  assert.equal(C("cash-bids/iowa/adair.html", '<meta property="og:description" content="Top bids for nearest delivery: corn $4.28 at 1 elevator. Updated Oct 19, 6:00 am CT.">'), 0);
  assert.equal(T("components/prf-notice.js", `      + ' data-topic="prf:' + grid + '" data-daily="on"' + (after ? ' data-after="' + after + '"' : '')`), 1);
  assert.equal(T("scripts/build_county_rain.py", `            f'data-topic="rainyear:{year}:{fips}" data-daily="on" '`), 1);
  assert.equal(T("components/homepage-extras.js", `'<label class="sa-optin"><input type="checkbox" class="we-optin" checked> Also send me AGSIST Daily, free, every morning</label>'`), 1);
  assert.equal(T("components/cb-signup.js", `'<div class="cbs-opt"><label class="cbs-ck"><input type="checkbox" class="cbs-d"' + (onDaily ? '' : ' checked') + '>' + '<span>Every morning: the top corn and soybean bids within 50 mi</span></label></div>'`), 1);
  assert.equal(T("components/cb-signup.js", `'<input type="checkbox" class="cbs-p" id="' + id + '-p"' + (onDaily ? ' checked' : '') + '>' + '<span>Tell me when</span></label>'`), 0, "the price alert box is not the Daily");
});

test("the 6am lines that sat next to a Daily link are gone", () => {
  const LIT = /by 6\s?am|6\s?am(\s|\u00a0|&nbsp;)CT/i;
  const bad = files().filter((f) => f.endsWith(".html") && LIT.test(visible(f, read(f))));
  assert.deepEqual(bad, []);
});
