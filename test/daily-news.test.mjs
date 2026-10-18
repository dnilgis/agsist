/* The AGSIST Daily as news (2026-10-16). Google News, Top stories and Bing
 * read the issue page itself: NewsArticle markup with Central-time dates,
 * one headline everywhere, a visible byline and published time, links to
 * the publisher's standards and corrections, a news sitemap of the last two
 * days, and an IndexNow ping that can never hold up the publish.
 * scripts/test_daily_news.py holds the hand-worked generator cases. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'");
const issues = readdirSync(join(ROOT, "daily")).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();

test("generator cases (scripts/test_daily_news.py)", () => {
  const out = execFileSync("python3", [join(ROOT, "scripts/test_daily_news.py")], { encoding: "utf8" });
  assert.match(out, /daily news checks: all passed/);
});

test("every issue: one NewsArticle, one headline, dates with an offset, a byline", () => {
  assert.ok(issues.length > 200);
  for (const f of issues) {
    const h = read("daily/" + f);
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const arts = lds.filter((x) => x["@type"] === "NewsArticle");
    assert.equal(arts.length, 1, f + ": one NewsArticle");
    const a = arts[0];
    const h1 = unesc(h.match(/<h1 class="dv3-headline">([\s\S]*?)<\/h1>/)[1]);
    const title = unesc(h.match(/<title>([\s\S]*?)<\/title>/)[1]);
    const og = unesc(h.match(/<meta property="og:title" content="([^"]*)"/)[1]);
    assert.ok(a.headline.length <= 110, f + ": headline over 110");
    assert.equal(a.headline, h1, f + ": NewsArticle headline = H1");
    assert.ok(title.startsWith(h1 + " | "), f + ": title starts with the H1: " + title);
    assert.equal(og, title, f + ": og:title = title");
    assert.match(a.datePublished, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[56]:00$/, f + ": datePublished");
    assert.ok(a.dateModified >= a.datePublished, f + ": modified before published");
    // The Jul 14 issue really went up on the evening of Jul 13 CT (a UTC-clock
    // run, before daily.yml ran on Central time). The page says so; every
    // other issue went up on its own Central-time day.
    if (f !== "2026-07-14.html") assert.equal(a.datePublished.slice(0, 10), f.slice(0, 10), f + ": published on its own Central-time day");
    else assert.equal(a.datePublished, "2026-07-13T19:56:02-05:00");
    assert.equal(a.author[0].name, "Sigurd Lindquist");
    assert.equal(a.author[0].url, "https://agsist.com/about");
    assert.equal(a.publisher.logo.url, "https://agsist.com/img/logo-agsist.png");
    assert.ok(a.image[0].width >= 1200, f + ": image 1200 wide");
    assert.ok(h.includes(`Published <time datetime="${a.datePublished}">`), f + ": visible published time = datePublished");
    // Sig, Oct 18: no name under the headline; the byline block at the end carries it
    assert.ok(/<p class="dv3-dateline">Published <time/.test(h), f + ": published time under the headline");
    assert.ok(!/dv3-dateline">[^<]*<a[^>]*>Sigurd/.test(h), f + ": no name under the headline");
    assert.ok(h.indexOf("Sigurd Lindquist", h.indexOf("dv3-headline")) > h.indexOf("dv3-dateline"), f + ": byline below the article top");
    assert.ok(h.includes("max-image-preview:large"), f + ": large image preview");
    assert.ok(h.includes(`<meta property="article:published_time" content="${a.datePublished}">`), f);
    for (const href of ["/editorial-standards#how-the-daily-is-made", "/editorial-standards#corrections", "/about", "/contact"])
      assert.ok(h.includes(`href="${href}"`), f + ": links " + href);
  }
});

test("a regenerated issue keeps its first publish time (Sep 4: 6:16 AM, rewritten 5:04 PM)", () => {
  const h = read("daily/2026-09-04.html");
  // first commit 2026-09-04T11:16:26Z = 6:16:26 AM CDT; generated_at 22:04:33Z = 5:04:33 PM CDT
  assert.ok(h.includes('"datePublished": "2026-09-04T06:16:26-05:00"'));
  assert.ok(h.includes('"dateModified": "2026-09-04T17:04:33-05:00"'));
  assert.ok(h.includes("Updated <time"));
});

test("corrections are dated and say what is right", () => {
  const h = read("daily/2026-10-10.html");
  assert.match(h, /<strong>Correction, Oct 15, 2026:<\/strong>[^<]*\$4\.79¾ on Oct 9, WASDE day, down 4\.1%/);
  assert.equal(((4.7975 - 5.0025) / 5.0025 * 100).toFixed(1), "-4.1");
});

test("news sitemap: last two days, Google's tags, listed in robots.txt", () => {
  const x = read("sitemap-news.xml");
  assert.ok(x.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'));
  const urls = [...x.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.ok(urls.length <= 1000);
  const dates = [];
  for (const u of urls) {
    const d = u.match(/<loc>https:\/\/agsist\.com\/daily\/(\d{4}-\d{2}-\d{2})<\/loc>/)[1];
    assert.ok(existsSync(join(ROOT, "daily", d + ".html")), d + " page exists");
    assert.ok(u.includes("<news:name>AGSIST</news:name><news:language>en</news:language>"));
    const p = u.match(/<news:publication_date>([^<]+)<\/news:publication_date>/)[1];
    assert.match(p, /T\d{2}:\d{2}:\d{2}-0[56]:00$/);
    assert.match(u, /<news:title>[^<]+<\/news:title>/);
    dates.push(Date.parse(p));
  }
  if (dates.length) assert.ok(Math.max(...dates) - Math.min(...dates) <= 48 * 3600e3, "all within two days");
  assert.match(read("robots.txt"), /^Sitemap: https:\/\/agsist\.com\/sitemap-news\.xml$/m);
});

test("daily.yml: commits the news sitemap and pings IndexNow last, never blocking", () => {
  const y = read(".github/workflows/daily.yml");
  assert.match(y, /git add [^\n]*sitemap-news\.xml/);
  const i = y.indexOf("- name: Ping IndexNow with today's issue");
  assert.ok(i > y.indexOf("- name: Send daily email"), "after the email");
  assert.ok(i > y.indexOf("- name: Send the forwarding brief to Sig"), "last step");
  assert.equal(y.indexOf("- name:", i + 10), -1, "nothing after it");
  const step = y.slice(i);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /timeout-minutes: \d+/);
  assert.match(step, /indexnow_submit\.py --urls "\$u"/);
  assert.ok(existsSync(join(ROOT, "scripts/indexnow_submit.py")));
});

test("editorial standards page: how the Daily is made, corrections, no em dashes", () => {
  const h = read("editorial-standards.html");
  for (const id of ["who", "how-the-daily-is-made", "sources", "independence", "corrections", "contact"])
    assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('<link rel="canonical"    href="https://agsist.com/editorial-standards">'));
  assert.ok(!h.includes("—"), "no em dashes");
  // Oct 16, Sig: toned down to one plain paragraph; the AI draft and the price check stay stated
  assert.match(h, /drafted each morning by AI software/);
  assert.match(h, /code checks every price in it against the market feed; a draft that fails does not post/);
  assert.match(h, /Sigurd Lindquist<\/a>, CCA /);
  assert.ok(!/insurance agent/i.test(h));
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const org = ld["@graph"].find((x) => x["@type"] === "NewsMediaOrganization");
  assert.equal(org.correctionsPolicy, "https://agsist.com/editorial-standards#corrections");
});

test("feed.xml: each item's pubDate is the issue's real publish time, one headline", () => {
  const x = read("feed.xml");
  const items = [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.ok(items.length > 0);
  for (const it of items.slice(0, 10)) {
    const d = it.match(/daily\/(\d{4}-\d{2}-\d{2})<\/link>/)[1];
    const h = read("daily/" + d + ".html");
    const a = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1])).find((o) => o["@type"] === "NewsArticle");
    const pub = Date.parse(it.match(/<pubDate>([^<]+)<\/pubDate>/)[1]);
    assert.equal(pub, Date.parse(a.datePublished), d + ": pubDate = datePublished");
    assert.equal(unesc(it.match(/<title>([^<]*)<\/title>/)[1]), a.headline, d + ": feed title = headline");
  }
  assert.ok(!/05:00:00 -0600/.test(x), "no made-up 5:00 AM stamps");
});

test("daily.html byline links how the briefing is made", () => {
  const h = read("daily.html");
  assert.ok(h.includes('<a href="/editorial-standards#how-the-daily-is-made">How this briefing is made</a>'));
  assert.ok(!h.includes("Written by <strong>Sigurd"));
});
