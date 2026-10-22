/* An elevator asks to post its own bids (2026-10-13).
 *
 *   - components/list-elevator.js: prefill from a map or town page link, the
 *     field rules (the worker's rules), the payload, the fallback email text.
 *   - list-your-elevator.html in a browser against a mocked worker: prefill,
 *     every field checked, what is posted, every typed value escaped in the
 *     answer, the email fallback when the worker cannot take it.
 *   - elev-admin.html Requests against a mocked worker and roster: the
 *     directory match, "Make the listing" filling the create form, create
 *     marking the request made, Dismiss.
 *   - the page's place in the site: indexable, in the sitemap, linked from
 *     the map's grey pins, the elevators page and the cash bids page.
 *
 * The browser parts need Playwright and Chromium; without them they are
 * skipped and say so. LIST_ELEV_SHOTS=<dir> also saves screenshots.
 *
 *   node --test test/list-elevator.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const L = createRequire(import.meta.url)(ROOT + "components/list-elevator.js");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.LIST_ELEV_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const HOSTILE = `Sam's 12" <img src=x onerror="window.__xss=1"> & Sons`;

test("prefill: directory id, names in plain case, town without its state, bad values dropped", () => {
  assert.deepEqual(L.prefill("?id=reg%3AWY%7Cwestplainsllc%7Clingle&name=WEST%20PLAINS%2C%20LLC&town=PINE%20BLUFFS&state=wy&zip=82223"),
    { dir_id: "reg:WY|westplainsllc|lingle", state: "WY", elevator: "West Plains, LLC", town: "Pine Bluffs", zip: "82223" });
  assert.deepEqual(L.prefill("?id=known%3A2837&name=The%20Maschhoffs&town=ALBIN%2C%20WY&state=WY"),
    { dir_id: "known:2837", state: "WY", elevator: "The Maschhoffs", town: "Albin" });
  assert.deepEqual(L.prefill("?id=evil%3A1&state=Wyoming&zip=8222&name=%20%20"), {}, "unknown id prefix, long state, short zip, blank name");
  assert.equal(L.prefill("?id=known%3A%3Cscript%3E").dir_id, undefined, "markup in an id is refused");
  assert.equal(L.prefill("?name=" + "a".repeat(300)).elevator.length, 120, "cut to the field's length");
  assert.equal(L.prefill("?name=Bunge%0A%0DLadoga").elevator, "Bunge Ladoga", "control characters gone");
  assert.equal(L.prefill("?name=" + encodeURIComponent(HOSTILE)).elevator, HOSTILE, "a value is kept as typed; it only ever goes into an input value");
  assert.deepEqual(L.prefill(""), {});
  assert.equal(L.niceCase("ST. JOSEPH"), "St. Joseph");
  assert.equal(L.niceCase("Agrex Inc"), "Agrex Inc", "mixed case is left alone");
});

test("link: what the map and town pages build round-trips through prefill", () => {
  const u = L.link({ id: "reg:MO|bartlett|stjoseph", name: "Bartlett Grain Company, LLC", town: "Saint Joseph", state: "mo", zip: "64504" });
  assert.equal(u, "/list-your-elevator?id=reg%3AMO%7Cbartlett%7Cstjoseph&name=Bartlett%20Grain%20Company%2C%20LLC&town=Saint%20Joseph&state=MO&zip=64504");
  assert.deepEqual(L.prefill(u.split("?")[1]), { dir_id: "reg:MO|bartlett|stjoseph", state: "MO", elevator: "Bartlett Grain Company, LLC", town: "Saint Joseph", zip: "64504" });
  assert.equal(L.link({ id: "x:1", name: "A" }), "/list-your-elevator?name=A");
  assert.equal(L.link(), "/list-your-elevator");
});

const GOOD = { elevator: "Lingle Elevator", town: "Lingle", state: "WY", zip: "82223", name: "Pat Doe", role: "Manager",
  phone: "(307) 555-0100", email: "pat@example.com", crops: ["wheat", "corn"], how: "phone", note: "", dir_id: "reg:WY|x|lingle" };

test("field rules: each required field, and the worker's shapes", () => {
  assert.deepEqual(L.check(GOOD), {});
  const bad = (patch) => Object.keys(L.check(Object.assign({}, GOOD, patch)));
  assert.deepEqual(bad({ elevator: "" }), ["elevator"]);
  assert.deepEqual(bad({ town: "" }), ["town"]);
  assert.deepEqual(bad({ state: "Wyoming" }), ["state"]);
  assert.deepEqual(bad({ zip: "8222" }), ["zip"]);
  assert.deepEqual(bad({ zip: "82223-1234" }), ["zip"]);
  assert.deepEqual(bad({ name: "" }), ["name"]);
  assert.deepEqual(bad({ role: "" }), ["role"]);
  assert.deepEqual(bad({ phone: "" }), ["phone"]);
  assert.deepEqual(bad({ phone: "555-0100" }), ["phone"]);
  assert.deepEqual(bad({ phone: "call 3075550100" }), ["phone"]);
  assert.deepEqual(bad({ email: "pat@" }), ["email"]);
  assert.deepEqual(bad({ crops: [] }), ["crops"]);
  assert.deepEqual(bad({ crops: ["hay"] }), ["crops"]);
  assert.deepEqual(bad({ how: "" }), ["how"]);
  assert.deepEqual(bad({ note: "n".repeat(601) }), ["note"]);
  assert.equal(Object.keys(L.check({})).length, 10, "an empty form: every required field");
  /* the page's lists are the worker's lists */
  const w = read("workers/subs-worker.js");
  assert.match(w, /const EL_CROPS = \["corn", "soybeans", "wheat", "sorghum", "oats", "other"\];/);
  assert.deepEqual(L.CROPS, ["corn", "soybeans", "wheat", "sorghum", "oats", "other"]);
  assert.match(w, /const EL_HOW = \["email", "phone", "not-sure"\];/);
  assert.deepEqual(L.HOW, ["email", "phone", "not-sure"]);
  assert.ok(w.includes(String(L.DIR_ID_RE).slice(1, -1)), "the dir_id rule is the worker's");
});

test("payload and the email fallback", () => {
  const p = L.payload(GOOD);
  assert.deepEqual(p, { elevator: "Lingle Elevator", town: "Lingle", state: "WY", zip: "82223", name: "Pat Doe", role: "Manager",
    phone: "(307) 555-0100", email: "pat@example.com", crops: "corn, wheat", how: "phone", page: "/list-your-elevator", dir_id: "reg:WY|x|lingle" });
  assert.equal(L.payload(Object.assign({}, GOOD, { dir_id: "nope" })).dir_id, undefined);
  assert.equal(L.subject(p), "Elevator wants to post bids: Lingle Elevator, Lingle WY");
  const t = L.bodyText(Object.assign({}, p, { note: "After 3" }));
  assert.ok(t.includes("How to post: A private phone link") && t.includes("Note: After 3") && t.includes("Directory id: reg:WY|x|lingle") && t.endsWith("Sent from agsist.com/list-your-elevator"), t);
  assert.ok(!L.bodyText(Object.assign({}, p, { dir_id: undefined })).includes("Directory id"));
});

test("the page: indexable, in the sitemap, structured data, and linked from the map, elevators and cash bids", () => {
  const h = read("list-your-elevator.html");
  assert.match(h, /<link rel="canonical"\s+href="https:\/\/agsist.com\/list-your-elevator">/);
  assert.match(h, /<meta name="robots" content="index, follow/);
  for (const b of h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(b.replace(/<\/?script[^>]*>/g, ""));
  // the freshness bake re-serializes JSON-LD with spaces, so match the type, not the spacing
  assert.ok(/"@type":\s*"FAQPage"/.test(h) && /"@type":\s*"BreadcrumbList"/.test(h));
  assert.ok(h.includes("static-nav:header") && h.includes("static-nav:footer"), "site nav and footer");
  assert.ok(h.includes("I run AGSIST"), "Sig's own voice");
  assert.ok(!/—/.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), "no em dashes in the copy");
  assert.ok(read("sitemap.xml").includes("<loc>https://agsist.com/list-your-elevator</loc>"));
  const el = read("elevators.html");
  assert.ok(el.includes("a[2] === 'known' ? claimLink(a, p.s)") && el.includes("Is this yours? Post your bids free"), "grey pins link to the form");
  assert.ok(el.includes("href=\"/list-your-elevator?' + esc(q) + '\""), "the pin's link is escaped");
  assert.ok(el.includes('<a href="/list-your-elevator">'));
  assert.ok(read("cash-bids.html").includes('Run an elevator? <a href="/list-your-elevator"'));
  assert.match(read("elev-admin.html"), /noindex, nofollow/);
});

/* ---------------- in a browser ---------------- */
const ROSTER = { elevators: [
  { id: "reg:WY|westplainsllc|lingle", operator: "West Plains, LLC", location: "Lingle", state: "WY", status: "known", lat: 42.1346, lon: -104.332, precision: "town", facility: "West Plains Elevator" },
  { id: "known:2837", operator: "The Maschhoffs", location: "ALBIN, WY", state: "WY", status: "known", lat: 41.41607, lon: -104.09986, precision: "street", address: "515 Albin St", phone: "307-246-3581" }] };

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let path = decodeURIComponent(u.pathname);
    if (!extname(path) && path !== "/") path += ".html";
    const p = normalize(join(ROOT, path));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function page(browser, width, theme = "dark") {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return p;
}

test("the request form in a browser: prefill, checks, the post, escaping, the fallback", { skip }, async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const p = await page(browser, width);
      const posts = [];
      let answer = { status: 200, body: { ok: true } };
      await p.route("https://agsist-subs.dnilgis.workers.dev/**", async (r) => {
        posts.push(JSON.parse(r.request().postData() || "{}"));
        await r.fulfill({ status: answer.status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(answer.body) });
      });
      await p.goto(base + "/list-your-elevator");
      await p.waitForSelector("#le-state option[value=WY]", { state: "attached" });
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/landing-${width}.png`, fullPage: true });
      assert.equal(await p.locator("#le-from").isHidden(), true, "no map line without a link");
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll at " + width);

      /* prefilled from a grey pin's link, with a hostile name */
      await p.goto(base + "/list-your-elevator?id=" + encodeURIComponent("reg:WY|westplainsllc|lingle") + "&name=" + encodeURIComponent(HOSTILE) +
        "&town=LINGLE&state=WY&zip=82223");
      await p.waitForSelector("#le-from:not([hidden])");
      assert.equal(await p.inputValue("#le-elevator"), HOSTILE);
      assert.equal(await p.inputValue("#le-town"), "Lingle");
      assert.equal(await p.inputValue("#le-state"), "WY");
      assert.equal(await p.inputValue("#le-zip"), "82223");
      assert.equal(await p.inputValue("input[name=dir_id]"), "reg:WY|westplainsllc|lingle");
      assert.ok((await p.textContent("#le-from")).includes(HOSTILE), "the map line shows the name as text");
      assert.equal(await p.evaluate(() => window.__xss), undefined);

      /* send with nothing else filled: every missing field says so, nothing posted */
      await p.click("#le-send");
      for (const k of ["name", "role", "phone", "email", "crops", "how"]) assert.ok((await p.textContent(`#le-${k}-e`)).length > 0, k + " error shown");
      assert.equal(await p.textContent("#le-elevator-e"), "", "a prefilled field passes");
      assert.equal(posts.length, 0);
      await p.fill("#le-name", HOSTILE.slice(0, 60));
      await p.fill("#le-role", "Manager");
      await p.fill("#le-phone", "307-555-01");
      await p.fill("#le-email", "pat@example.com");
      await p.check("input[name=crops][value=wheat]");
      await p.check("input[name=crops][value=corn]");
      await p.check("input[name=how][value=email]");
      await p.fill("#le-note", "Call after 3.\nAsk for Pat.");
      await p.click("#le-send");
      assert.ok((await p.textContent("#le-phone-e")).includes("area code"));
      assert.equal(posts.length, 0, "a short phone number is not sent");
      await p.fill("#le-phone", "307-555-0100");
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/landing-prefilled-${width}.png`, fullPage: true });
      await p.click("#le-send");
      await p.waitForSelector(".cl-msg.ok");
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0], { kind: "elevator-listing", elevator: HOSTILE, town: "Lingle", state: "WY", zip: "82223", name: HOSTILE.slice(0, 60),
        role: "Manager", phone: "307-555-0100", email: "pat@example.com", crops: "corn, wheat", how: "email", page: "/list-your-elevator",
        note: "Call after 3.\nAsk for Pat.", dir_id: "reg:WY|westplainsllc|lingle" });
      const ok = await p.textContent(".cl-msg.ok");
      assert.ok(ok.includes(HOSTILE) && ok.includes("pat@example.com") && ok.includes("call the elevator at its own number"), ok);
      assert.equal(await p.evaluate(() => window.__xss), undefined, "nothing typed runs");
      assert.equal(await p.locator("#le-form").isHidden(), true, "the form folds away once sent");
      if (SHOTS) await p.locator("#le-ask").screenshot({ path: `${SHOTS}/landing-sent-${width}.png` });

      /* the worker refuses: nothing is lost, the email way is offered with the same text */
      await p.reload();
      await p.waitForSelector("#le-from:not([hidden])");
      for (const [s, v] of [["#le-name", "Pat"], ["#le-role", "Manager"], ["#le-phone", "307-555-0100"], ["#le-email", "pat@example.com"]]) await p.fill(s, v);
      await p.check("input[name=crops][value=oats]");
      await p.check("input[name=how][value=not-sure]");
      answer = { status: 429, body: { ok: false, error: "too many posts; try again in an hour" } };
      await p.click("#le-send");
      await p.waitForSelector(".cl-msg.bad");
      const href = await p.getAttribute("#le-mail", "href");
      assert.ok(href.startsWith("mailto:sig@agsist.com?subject=Elevator%20wants%20to%20post%20bids%3A"), href);
      const ta = await p.inputValue("#le-copy-ta");
      assert.ok(ta.includes("Elevator: " + HOSTILE) && ta.includes("How to post: Not sure yet"), ta);
      assert.equal(await p.inputValue("#le-name"), "Pat", "typed values kept after a refusal");
      assert.equal(await p.evaluate(() => window.__xss), undefined);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("Sig's desk: requests with the roster match, Make the listing, Dismiss", { skip }, async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const p = await page(browser, width);
      const now = Date.now();
      const store = {
        "form:elevator-listing:1760380000000:0a0a0a0a": { kind: "elevator-listing", ts: now - 3600e3, n: 1, status: "pending", elevator: "West Plains", town: "Lingle", state: "WY", zip: "82223",
          name: "Pat Doe", role: "Manager", phone: "307-555-0100", email: "pat@example.com", crops: "corn, wheat", how: "phone", note: "Call after 3.\n<b>bold</b>", dir_id: "reg:WY|westplainsllc|lingle" },
        "form:elevator-listing:1760390000000:0b0b0b0b": { kind: "elevator-listing", ts: now - 600e3, n: 0, elevator: HOSTILE, town: "Albin", state: "WY", zip: "82050",
          name: "Lee", role: "Merchandiser", phone: "307-555-0101", email: "lee@example.com", crops: "corn", how: "not-sure" },
        "form:elevator-listing:1760300000000:0c0c0c0c": { kind: "elevator-listing", ts: now - 86400e3, n: 1, status: "dismissed", elevator: "Old Ask", town: "Nowhere", state: "IA", zip: "50001",
          name: "X", role: "Y", phone: "515-555-0100", email: "x@example.com", crops: "corn", how: "email" } };
      const calls = [];
      await p.route("https://dnilgis.github.io/bids/data/directory.json", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(ROSTER) }));
      await p.route("https://agsist-subs.dnilgis.workers.dev/**", async (r) => {
        const u = new URL(r.request().url()), body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
        calls.push([u.pathname, body, r.request().headers().authorization]);
        const send = (j, s = 200) => r.fulfill({ status: s, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(j) });
        if (r.request().headers().authorization !== "Bearer tok") return send({ ok: false }, 403);
        if (u.pathname === "/elev/admin/list") return send({ ok: true, elevators: [] });
        if (u.pathname === "/elev/admin/requests") return send({ ok: true, requests: Object.entries(store).map(([key, q]) => Object.assign({ key, status: "pending" }, q)).sort((a, b) => b.ts - a.ts) });
        if (u.pathname === "/elev/admin/request") { Object.assign(store[body.key], { status: body.status, elev_id: body.id }); return send({ ok: true, key: body.key, status: body.status, id: body.id || null }); }
        if (u.pathname === "/elev/admin/create") return send({ ok: true, id: body.id, link: "https://agsist.com/post?k=abcdefghijklmnopqrstuvwx" });
        return send({ ok: false, error: "not found" }, 404);
      });
      await p.goto(base + "/elev-admin");
      await p.fill("#tok", "tok");
      await p.click("#r-load");
      await p.waitForSelector(".match.hit");
      assert.equal((await p.textContent("#r-out")).trim(), "2 waiting, 1 made or dismissed.");
      assert.equal(await p.locator(".req").count(), 2, "only the waiting ones");
      const first = p.locator(".req").first(), second = p.locator(".req").nth(1);
      assert.ok((await first.textContent()).includes(HOSTILE), "the newest first, its name as text");
      assert.equal(await p.evaluate(() => window.__xss), undefined, "a hostile request does not run");
      assert.ok((await second.locator(".match").textContent()).includes("West Plains, LLC, Lingle WY"), "matched by the link's id");
      assert.ok((await second.textContent()).includes("<b>bold</b>"), "the note is shown as typed, not as markup");
      assert.ok((await first.locator(".match").textContent()).includes("Not found in the elevator list"), "no id, no name match");
      if (SHOTS) await p.locator("#requests").screenshot({ path: `${SHOTS}/admin-requests-${width}.png` });

      /* Make the listing: the create form is filled, Sig presses Add, the request is marked made */
      await second.locator("[data-make]").click();
      assert.equal(await p.inputValue("#c-name"), "West Plains");
      assert.equal(await p.inputValue("#c-town"), "Lingle");
      assert.equal(await p.inputValue("#c-state"), "WY");
      assert.equal(await p.inputValue("#c-zip"), "82223");
      assert.equal(await p.inputValue("#c-id"), "west-plains-lingle-wy");
      assert.equal(await p.inputValue("#c-ll"), "42.1346, -104.332");
      assert.equal(await p.inputValue("#c-cname"), "Pat Doe");
      assert.equal(await p.inputValue("#c-cphone"), "307-555-0100");
      assert.equal(await p.inputValue("#c-email"), "pat@example.com");
      assert.ok((await p.textContent("#c-from")).includes("only the town centre"), "a town-centre pin is called out");
      assert.ok(!calls.some((c) => c[0] === "/elev/admin/create"), "nothing is made until Sig presses Add");
      if (SHOTS) await p.locator("#add").screenshot({ path: `${SHOTS}/admin-make-${width}.png` });
      await p.click("#create button[type=submit]");
      await p.waitForSelector("#c-out.good");
      await p.waitForFunction(() => document.querySelectorAll(".req").length === 1);
      const mark = calls.find((c) => c[0] === "/elev/admin/request");
      assert.deepEqual(mark[1], { key: "form:elevator-listing:1760380000000:0a0a0a0a", status: "created", id: "west-plains-lingle-wy" });
      assert.ok(calls.every((c) => c[2] === "Bearer tok"), "every call carries the token in the header");
      assert.equal(await p.locator("#c-from").isHidden(), true);

      /* Dismiss the other one */
      p.once("dialog", (d) => d.accept());
      await p.locator(".req [data-dismiss]").click();
      await p.waitForFunction(() => /Nothing waiting/.test(document.getElementById("r-list").textContent));
      assert.equal(store["form:elevator-listing:1760390000000:0b0b0b0b"].status, "dismissed");
      await p.check("#r-done");
      await p.waitForFunction(() => document.querySelectorAll(".req").length === 3);
      assert.ok((await p.textContent("#r-list")).includes("made: west-plains-lingle-wy"));
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});
