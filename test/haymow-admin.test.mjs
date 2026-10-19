/* haymow-admin.html: Sig's desk for The Haymow (2026-10-18, Sig: "build the admin page").
 *
 *   - the page: noindex, no referrer, no analytics, not in a sitemap or the menu,
 *     the token only in the Authorization header (never in an address), and it
 *     calls nothing but /hay/admin/list, hide, clear and mark.
 *   - in a browser against a mocked worker: newest first, the filters, report
 *     counts and reasons, a poster's phone and email kept out of the page until
 *     "Show phone and email", Hide / Clear / Mark seen and what each sends,
 *     a hostile note shown as text, #<id> from the digest marks that post.
 *
 * The browser part needs Playwright and Chromium; without them it is skipped and says so.
 *   node --test test/haymow-admin.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const A = read("haymow-admin.html");
const script = A.slice(A.indexOf("<script>"), A.lastIndexOf("</script>"));

test("the page: noindex, no referrer, no analytics, no em dash, not in a sitemap or the menu", () => {
  assert.match(A, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(A, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(A, /googletagmanager|G-6KXCTD5Z9H|gtag\(|components\/loader\.js/, "no analytics, no loader");
  assert.doesNotMatch(A, /—/, "no em dash");
  for (const f of readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) assert.doesNotMatch(read(f), /haymow-admin/, f);
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html", "haymow.html", "llms.txt"]) {
    if (existsSync(ROOT + f)) assert.doesNotMatch(read(f), /haymow-admin/, `${f} does not link the desk`);
  }
});

test("the token goes only in the Authorization header; the page calls only /hay/admin/*", () => {
  assert.doesNotMatch(A, /[?&]token=/, "the token never goes in a URL");
  assert.doesNotMatch(script, /console\./, "nothing is logged");
  assert.match(script, /Authorization: 'Bearer ' \+ tok/);
  assert.match(script, /var API = 'https:\/\/agsist-subs\.dnilgis\.workers\.dev\/hay\/admin\/';/);
  assert.equal((script.match(/fetch\(/g) || []).length, 1, "one fetch, through call()");
  assert.match(script, /fetch\(API \+ path,/);
  const paths = [...script.matchAll(/call\('([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3, "list and mark by name");
  for (const p of paths) assert.ok(["list", "hide", "clear", "mark"].includes(p), p);
  assert.match(script, /call\(act, \{ id: id \}\)/, "hide and clear by the button's act");
  assert.match(script, /act === 'hide'|data-act="hide"/);
  /* the worker answers each of those under Bearer LIST_TOKEN */
  const W = read("workers/subs-worker.js");
  for (const p of ["list", "hide", "clear", "mark"]) assert.ok(W.includes(`"/hay/admin/${p}"`), `worker has /hay/admin/${p}`);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(path) && path !== "/") path += ".html";
    const p = normalize(join(ROOT, path));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const HOSTILE = `Good hay <img src=x onerror="window.__xss=1"> & more`;
const now = Date.now();
const base = { zip: "54728", place: "Chetek, WI", lat: 45.31, lng: -91.65, cutting: "", bale: "round", count: null, price: null, unit: "", weight: null,
  rfv: null, rfq: null, cp: null, delivery: "no", note: "", name: "", updated: 0, exp: now + 20 * 86400e3, why_hidden: "", reports: [], n: 1, hn: 1 };
function posts() {
  return [
    Object.assign({}, base, { id: "aaaaaaaaaa", kind: "sale", product: "alfalfa", cutting: "2", count: 120, price: 65, unit: "bale", rfv: 160, ts: now - 5 * 86400e3, updated: now - 5 * 86400e3,
      status: "live", name: "Ole", phone: "715-555-0101", email: "ole@example.com" }),
    Object.assign({}, base, { id: "bbbbbbbbbb", kind: "wanted", product: "grass", ts: now - 3600e3, updated: now - 3600e3, status: "held", why_hidden: "all caps", n: 0, hn: 0,
      note: HOSTILE, phone: "", email: "lena@example.com" }),
    Object.assign({}, base, { id: "cccccccccc", kind: "sale", product: "straw", count: 300, ts: now - 2 * 86400e3, updated: now - 2 * 86400e3, status: "hidden", why_hidden: "reports",
      reports: [{ why: "spam", ts: now - 7200e3 }, { why: "scam", ts: now - 3600e3 }, { why: "spam", ts: now - 1800e3 }], phone: "715-555-0103", email: "" }),
  ];
}

test("in a browser: newest first, filters, contacts on demand, Hide / Clear / Mark seen", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), origin = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      const store = posts(), calls = [], urls = [];
      p.on("request", (r) => urls.push(r.url()));
      await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await p.route("https://agsist-subs.dnilgis.workers.dev/**", async (r) => {
        const u = new URL(r.request().url()), body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
        const send = (j, s = 200) => r.fulfill({ status: s, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(j) });
        calls.push([r.request().method(), u.pathname + u.search, body, r.request().headers().authorization]);
        if (r.request().headers().authorization !== "Bearer tok") return send({ ok: false }, 403);
        const rec = body && store.find((x) => x.id === body.id);
        if (u.pathname === "/hay/admin/list") return send({ ok: true, posts: store.slice().sort((a, b) => a.ts - b.ts) });
        if (u.pathname === "/hay/admin/hide") { Object.assign(rec, { status: "hidden", why_hidden: "sig", hn: 1 }); return send({ ok: true, id: rec.id, status: rec.status }); }
        if (u.pathname === "/hay/admin/clear") { Object.assign(rec, { status: "live", reports: [], why_hidden: "", hn: 1 }); return send({ ok: true, id: rec.id, status: rec.status }); }
        if (u.pathname === "/hay/admin/mark") { let m = 0; for (const id of body.ids) { const x = store.find((y) => y.id === id); if (x) { x.n = 1; m++; } } return send({ ok: true, marked: m }); }
        return send({ ok: false, error: "not found" }, 404);
      });

      /* a wrong token says so */
      await p.goto(origin + "/haymow-admin");
      await p.fill("#tok", "nope");
      await p.click("#load");
      await p.waitForFunction(() => /not accepted/.test(document.getElementById("out").textContent));

      /* from a digest link: #<id> marks that post */
      await p.goto(origin + "/haymow-admin#cccccccccc");
      await p.fill("#tok", "tok");
      await p.click("#load");
      await p.waitForSelector(".post");
      assert.equal((await p.textContent("#out")).trim(), "3 posts: 1 live, 1 held, 1 hidden, 1 reported.");
      assert.deepEqual(await p.$$eval(".post", (els) => els.map((e) => e.dataset.id)), ["bbbbbbbbbb", "cccccccccc", "aaaaaaaaaa"], "newest first");
      assert.equal(await p.getAttribute("#p-cccccccccc", "class"), "post pick");
      const txt = await p.textContent("#list");
      assert.ok(txt.includes("For sale: Alfalfa, 2nd cutting, 120 round bales, $65 a bale"), "public text in plain words");
      assert.ok(txt.includes("Held: all caps") && txt.includes("Hidden: hidden by reports") && txt.includes("3 reports"));
      assert.ok(txt.includes("spam (") && txt.includes("scam ("), "report reasons with times");
      assert.ok(txt.includes(HOSTILE), "a hostile note is shown as typed");
      assert.equal(await p.evaluate(() => window.__xss), undefined, "and does not run");

      /* phones and emails stay out of the page until asked for, one post at a time */
      const html = async () => p.content();
      for (const s of ["715-555-0101", "ole@example.com", "lena@example.com", "715-555-0103"]) assert.ok(!(await html()).includes(s), `${s} not in the page`);
      await p.click('#p-aaaaaaaaaa [data-act="contact"]');
      assert.ok((await p.textContent("#p-aaaaaaaaaa .contact")).includes("715-555-0101"));
      assert.ok((await html()).includes("ole@example.com"));
      assert.ok(!(await html()).includes("lena@example.com") && !(await html()).includes("715-555-0103"), "only that post's");
      await p.click('#p-aaaaaaaaaa [data-act="contact"]');
      assert.ok(!(await html()).includes("715-555-0101"), "hidden again");

      /* filters */
      for (const [f, ids] of [["held", ["bbbbbbbbbb"]], ["reported", ["cccccccccc"]], ["hidden", ["cccccccccc"]], ["live", ["aaaaaaaaaa"]], ["all", ["bbbbbbbbbb", "cccccccccc", "aaaaaaaaaa"]]]) {
        await p.selectOption("#show", f);
        assert.deepEqual(await p.$$eval(".post", (els) => els.map((e) => e.dataset.id)), ids, f);
      }
      assert.equal(await p.textContent('#show option[value="reported"]'), "Reported (1)");

      /* Hide a live post */
      assert.equal(await p.locator('#p-cccccccccc [data-act="hide"]').count(), 0, "no Hide on a hidden post");
      assert.equal(await p.locator('#p-aaaaaaaaaa [data-act="clear"]').count(), 0, "no Clear on a live post with no reports");
      await p.click('#p-aaaaaaaaaa [data-act="hide"]');
      await p.waitForFunction(() => /Hidden: aaaaaaaaaa/.test(document.getElementById("out").textContent));
      assert.ok((await p.textContent("#p-aaaaaaaaaa")).includes("Hidden: hidden by you"));
      /* Clear a reported post: asks first */
      let asked = "";
      p.once("dialog", (d) => { asked = d.message(); d.accept(); });
      await p.click('#p-cccccccccc [data-act="clear"]');
      await p.waitForFunction(() => /Cleared: cccccccccc/.test(document.getElementById("out").textContent));
      assert.match(asked, /drop its 3 reports/);
      assert.ok((await p.textContent("#p-cccccccccc")).includes("Live"));
      /* Mark seen */
      await p.click('#p-bbbbbbbbbb [data-act="mark"]');
      await p.waitForFunction(() => /Marked seen: bbbbbbbbbb/.test(document.getElementById("out").textContent));
      assert.equal(await p.locator('[data-act="mark"]').count(), 0);
      assert.equal(await p.isHidden("#mark-all"), true);

      const posted = calls.filter((c) => c[0] === "POST").map((c) => [c[1], c[2]]);
      assert.deepEqual(posted, [["/hay/admin/hide", { id: "aaaaaaaaaa" }], ["/hay/admin/clear", { id: "cccccccccc" }], ["/hay/admin/mark", { ids: ["bbbbbbbbbb"] }]]);
      assert.ok(calls.every((c) => /^\/hay\/admin\/(list|hide|clear|mark)$/.test(c[1])), "only /hay/admin/*, nothing in the query");
      assert.ok(calls.filter((c) => c[3] !== "Bearer nope").every((c) => c[3] === "Bearer tok"), "the token in the header");
      assert.ok(!urls.some((u) => /tok/.test(new URL(u).search + new URL(u).hash)), "the token is in no address");
      assert.ok(!urls.some((u) => !u.startsWith(origin) && !u.startsWith("https://agsist-subs.dnilgis.workers.dev/hay/admin/")), "no other host");
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
