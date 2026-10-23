/* The outbox (components/outbox.js, Oct 22 2026): what a browser keeps for
 * the subs worker while it is blocked, and sends once when it answers. Also
 * the gift card order (components/rp-gift.js) and the business quote
 * (components/form-post.js) that use it. Runs the shipped files in a bare vm
 * context: a shared localStorage stands for one browser, two contexts on it
 * for two tabs. The pages themselves: test/deferred-pages.test.mjs.
 *
 *   node --test test/outbox.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const W = "https://agsist-api.dnilgis.workers.dev";
const BLOCK = "<!DOCTYPE html><html><title>Suspected phishing site | Cloudflare</title></html>";

function storage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const res = (status, body, json = true) => ({ status, ok: status >= 200 && status < 300,
  json: async () => { if (!json) throw new SyntaxError("Unexpected token <"); return body; } });
const WORKERS = {
  blocked: async () => res(403, BLOCK, false),
  down: async () => { throw new TypeError("Failed to fetch"); },
  busy: async () => res(503, { ok: false }),
  slow429: async () => res(429, { ok: false, error: "too many requests" }),
};
// one tab: the shipped files in a fresh context on the browser's storage
function tab(ls, fetchImpl, files = ["components/outbox.js"]) {
  const c = { localStorage: ls, sessionStorage: storage(), setTimeout, clearTimeout, JSON, Promise, Date, Math, URLSearchParams,
    TextEncoder, TextDecoder, atob, btoa, FormData, AbortController };
  c.window = c;
  c.calls = [];
  c.fetch = async (u, init) => { c.calls.push({ u, init }); return c.impl(u, init); };
  c.impl = fetchImpl;
  for (const f of files) vm.runInNewContext(read(f), c);
  return c;
}
const kept = (ls) => JSON.parse(ls.getItem("agsist-outbox") || "[]");

test("blocked, down, busy or 429: nothing is lost and nothing is dropped", async () => {
  const ls = storage();
  const t = tab(ls, WORKERS.blocked);
  const id = t.AgOutbox.add({ url: W + "/hay/post", body: { kind: "sale", zip: "54728" }, label: "your hay board post" });
  assert.ok(id);
  for (const w of Object.values(WORKERS)) {
    t.impl = w;
    const r = await t.AgOutbox.flush({ quiet: true });
    assert.equal(r.sent.length, 0); assert.equal(r.refused.length, 0);
    assert.equal(kept(ls).length, 1, "still kept");
    assert.ok(!kept(ls)[0].sending, "not left marked as sending");
  }
  assert.equal(t.AgOutbox.add({ url: "https://evil.example/x", body: {} }), "", "only the worker's own address");
});

test("worker back: each item goes once, in order, and the outbox empties; a second flush sends nothing", async () => {
  const ls = storage();
  const t = tab(ls, WORKERS.blocked);
  t.AgOutbox.add({ url: W + "/form", body: { kind: "rain-print-business", towns: "A, B" }, label: "your quote" });
  t.AgOutbox.add({ url: W + "/elev/save", body: { k: "x", no_change: true }, label: "your bids" });
  t.impl = async () => res(200, { ok: true });
  const r = await t.AgOutbox.flush({ quiet: true });
  assert.deepEqual([...r.sent], ["your quote", "your bids"]);
  assert.deepEqual(t.calls.map((c) => c.u), [W + "/form", W + "/elev/save"]);
  assert.equal(JSON.parse(t.calls[0].init.body).towns, "A, B");
  assert.equal(t.calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(ls.getItem("agsist-outbox"), null);
  await t.AgOutbox.flush({ quiet: true });
  assert.equal(t.calls.length, 2, "no duplicate");
});

test("two tabs open at once send each item once", async () => {
  const ls = storage();
  const a = tab(ls, async () => { await new Promise((r) => setTimeout(r, 40)); return res(200, { ok: true }); });
  const b = tab(ls, async () => res(200, { ok: true }));
  a.AgOutbox.add({ url: W + "/rp-gift/redeem", body: { code: "RP-1" }, label: "gift" });
  a.AgOutbox.add({ url: W + "/hay/edit", body: { id: "h1" }, label: "hay" });
  await Promise.all([a.AgOutbox.flush({ quiet: true }), b.AgOutbox.flush({ quiet: true }), a.AgOutbox.flush({ quiet: true })]);
  await b.AgOutbox.flush({ quiet: true });
  assert.equal(a.calls.length + b.calls.length, 2, "two items, two posts in all");
  assert.equal(kept(ls).length, 0);
});

test("a refusal the worker means is dropped and reported; expired items are dropped unsent", async () => {
  const ls = storage();
  const t = tab(ls, async () => res(409, { ok: false, error: "This card was used on Oct 1, 2026." }));
  t.AgOutbox.add({ url: W + "/rp-gift/redeem", body: { code: "RP-1" }, label: "your gift card order" });
  t.AgOutbox.add({ url: W + "/elev/save", body: { k: "x" }, label: "your bids", expires: Date.now() - 1 });
  assert.equal(t.AgOutbox.list().length, 1, "the expired one is not kept");
  const r = await t.AgOutbox.flush({ quiet: true });
  assert.deepEqual([...r.refused], ["your gift card order: This card was used on Oct 1, 2026."]);
  assert.equal(t.calls.length, 1);
  assert.equal(kept(ls).length, 0);
});

test("a hay post sent later leaves its private edit link where the hay board looks", async () => {
  const ls = storage();
  const t = tab(ls, async () => res(200, { ok: true, id: "h7", key: "k7", status: "live" }));
  t.AgOutbox.add({ url: W + "/hay/post", body: { kind: "wanted" }, label: "your hay board post", after: "hay-mine", meta: { kind: "wanted" } });
  await t.AgOutbox.flush({ quiet: true });
  const mine = JSON.parse(ls.getItem("agsist-hay-mine"));
  assert.equal(mine[0].id, "h7"); assert.equal(mine[0].key, "k7"); assert.equal(mine[0].kind, "wanted");
});

test("the /e confirm counts any JSON answer without ok:false as done", async () => {
  const ls = storage();
  const t = tab(ls, async () => res(200, { title: "You are confirmed" }));
  t.AgOutbox.add({ url: W + "/fd/watch-confirm?k=a&t=b", method: "POST", okIf: "json", label: "your alert confirm" });
  const r = await t.AgOutbox.flush({ quiet: true });
  assert.deepEqual([...r.sent], ["your alert confirm"]);
  assert.equal(t.calls[0].init.body, undefined, "a bare POST");
});

test("storage that throws: add says it kept nothing, so the page says it did not go through", () => {
  const ls = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  const t = tab(ls, WORKERS.blocked);
  assert.equal(t.AgOutbox.add({ url: W + "/hay/post", body: {} }), "");
});

// ---------- gift card order (components/rp-gift.js) ----------
const CODE = (() => {
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ", body = "7K3MQ9TWH2F";
  let m = 0; for (const ch of body) m = (m * 32 + B32.indexOf(ch)) % 37;
  return "RP-" + (body + B32[m]).replace(/^(.{4})(.{4})(.{4})$/, "$1-$2-$3");
})();
test("gift card: with the worker blocked the card can still be used, the order is kept, and goes once when it is back", async () => {
  if (!/^RP-7K3M-Q9TW-H2F/.test(CODE) || CODE.length !== 17) return assert.fail("check char");
  const ls = storage();
  const t = tab(ls, WORKERS.blocked, ["components/outbox.js", "components/rp-gift.js"]);
  const G = await t.AgRpGift.open(CODE);
  assert.equal(G.ok, true); assert.equal(G.usable, true); assert.equal(G.deferred, true);
  assert.match(G.steps.join(" "), /saved on this device and goes through when our system is back/);
  const order = { name: "Pat Example", email: "pat@example.com", address: "1 Main St, Testville WI 54000", design_code: "MXxUZXN0dmlsbGU", page: "/rain-print" };
  const r = await t.AgRpGift.redeem(G, order);
  assert.deepEqual({ ...r }, { ok: true, queued: true });
  assert.equal(G.usable, false, "no second press");
  const html = t.AgRpGift.doneHtml(G, r);
  assert.match(html, /Saved\. It will go through when our system is back and you next open agsist\.com on this device; nothing else to do\./);
  assert.doesNotMatch(html, /is now used/);
  const k = kept(ls);
  assert.equal(k.length, 1);
  assert.equal(k[0].url, W + "/rp-gift/redeem");
  assert.equal(k[0].body.code, CODE); assert.equal(k[0].body.email, order.email);
  assert.equal(t.calls.filter((c) => /formspree/.test(c.u)).length, 0);
  t.impl = async () => res(200, { ok: true, redeemed_on: "Oct 23, 2026" });
  await t.AgOutbox.flush({ quiet: true });
  await t.AgOutbox.flush({ quiet: true });
  assert.equal(t.calls.filter((c) => c.u === W + "/rp-gift/redeem").length, 2, "one try while blocked, one when back");
  assert.equal(kept(ls).length, 0);
});

test("gift card: the worker's own answers are unchanged (a used card, a bad code, the worker up)", async () => {
  const ls = storage();
  const t = tab(ls, async () => res(200, { ok: true, kind: "open", product: "framed12x18", status: "open" }), ["components/outbox.js", "components/rp-gift.js"]);
  let G = await t.AgRpGift.open(CODE);
  assert.ok(!G.deferred); assert.equal(G.usable, true);
  t.impl = async () => res(200, { ok: true, redeemed_on: "Oct 22, 2026", ships: "now" });
  const r = await t.AgRpGift.redeem(G, { name: "P", email: "p@example.com", address: "1 Main St, Testville" });
  assert.equal(r.queued, undefined); assert.equal(kept(ls).length, 0);
  t.impl = async () => res(404, { ok: false, error: "We don't know that code. Check it against the card." });
  G = await t.AgRpGift.open(CODE);
  assert.equal(G.ok, false); assert.match(G.error, /We don't know that code/);
  // without the outbox on the page, a blocked worker reads as before
  const u = tab(storage(), WORKERS.blocked, ["components/rp-gift.js"]);
  G = await u.AgRpGift.open(CODE);
  assert.equal(G.ok, false); assert.match(G.error, /didn’t answer/);
});

// ---------- business quote (components/form-post.js) ----------
test("business quote: the list is kept in the browser, never sent to Formspree, and goes to the worker once when it is back", async () => {
  const ls = storage();
  const t = tab(ls, WORKERS.blocked, ["components/outbox.js", "components/form-post.js"]);
  const data = { business: "Test Co-op", name: "Lee", email: "lee@example.com", quantity: "12", towns: "Olson Farm, Chetek, WI, 2025\nPat Example, Barron, WI, 2025", page: "/rain-print-business" };
  const r = await t.agsistFormPost("rain-print-business", data, Object.assign({ _subject: "x" }, data));
  assert.equal(r.via, "outbox"); assert.equal(r.queued, true);
  assert.equal(t.calls.filter((c) => /formspree/.test(c.u)).length, 0, "never Formspree");
  const k = kept(ls);
  assert.equal(k.length, 1); assert.equal(k[0].url, W + "/form");
  assert.equal(k[0].body.kind, "rain-print-business"); assert.equal(k[0].body.towns, data.towns);
  t.impl = async () => res(200, { ok: true });
  await Promise.all([t.AgOutbox.flush({ quiet: true }), t.AgOutbox.flush({ quiet: true })]);
  assert.equal(t.calls.filter((c) => c.u === W + "/form" && JSON.parse(c.init.body).kind === "rain-print-business").length, 2, "one try blocked, one when back");
  assert.equal(kept(ls).length, 0);
  // other kinds keep the Formspree fallback; without the outbox, a business quote rejects as before
  t.impl = WORKERS.blocked;
  const o = await t.agsistFormPost("rain-print-order", { name: "P" }, { name: "P" }).catch((e) => e);
  assert.ok(o && (o.via === "formspree" || o.message === "not sent"));
  const u = tab(storage(), WORKERS.blocked, ["components/form-post.js"]);
  const e = await u.agsistFormPost("rain-print-business", data, data).then(() => null, (x) => x);
  assert.equal(e && e.workerOnly, true);
});

test("pages load the outbox, and loader.js loads it anywhere while something is kept", () => {
  for (const p of ["rain-print.html", "rain-print-business.html", "haymow.html", "post.html", "e.html"]) assert.match(read(p), /<script src="\/components\/outbox\.js\?v=3"/, p);
  const L = read("components/loader.js");
  assert.match(L, /localStorage\.getItem\('agsist-outbox'\)/);
  assert.match(L, /ob\.src = '\/components\/outbox\.js\?v=3'/);
  assert.match(L, /var CV = '96'/);   // 96: fx/merges, past 92 on main and 93 to 95 in open PRs; 92: fx/rainmonthly (signup-ask.js?v=16); was 85: fx/advertise
  const O = read("components/outbox.js");
  assert.match(O, /var LINE = 'Saved\. It will go through when our system is back and you next open agsist\.com on this device; nothing else to do\.';/);
  assert.doesNotMatch(O + read("components/rp-gift.js") + read("components/haymow.js") + read("components/elev-post.js"), /—/, "no em dashes");
});
