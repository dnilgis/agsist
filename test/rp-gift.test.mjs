/* Rain Print gift cards (worker v5.16, components/rp-gift.js, rp-gift.html).
 *
 * Runs workers/subs-worker.js against an in-memory KV, and the shipped
 * components/rain-print.js for real design codes.
 *
 *   node --test test/rp-gift.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(read("components/rain-print.js"), ctx);
const RP = ctx.RainPrint;

const tmp = path.join(os.tmpdir(), "rp-gift-test-" + process.pid + ".mjs");
copyFileSync(ROOT + "workers/subs-worker.js", tmp);
const W = (await import(pathToFileURL(tmp).href)).default;
unlinkSync(tmp);

function makeEnv() {
  const store = new Map();
  const SUBS = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix, limit }) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { keys: all.slice(0, limit || 1000).map((name) => ({ name })), list_complete: all.length <= (limit || 1000) };
    },
  };
  return { store, env: { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS } };
}
let ipN = 0;
const freshIp = () => { ipN++; return "10." + (ipN >> 16 & 255) + "." + (ipN >> 8 & 255) + "." + (ipN & 255); };
const H = "https://x.dev";
function pub(env, p, body, ip) {
  return W.fetch(new Request(H + p, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "https://agsist.com", "CF-Connecting-IP": ip || freshIp() } }), env);
}
function admin(env, p, body, tok = "tok") {
  return W.fetch(new Request(H + p, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok } }), env);
}
const DESIGN = { place: "Chetek, WI", station: "471667 2", year: 2025, name: "The Olson Farm", style: "r2" };
const CODE = RP.encodeCode(DESIGN);
const URL_ = RP.designUrl(DESIGN);
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function checkOf(body) { let m = 0; for (const ch of body) m = (m * 32 + B32.indexOf(ch)) % 37; return m; }
const order = (code, extra) => Object.assign({ code, name: "Ray Olson", email: "ray@example.com",
  address: "123 Farm Rd, Chetek WI 54728", design_url: URL_, design_code: CODE }, extra || {});

async function issue(env, extra) {
  const r = await admin(env, "/rp-gift/issue", Object.assign({ product: "framed12x18", order_ref: "RP-1042",
    giver: { name: "Kate Olson", email: "Kate@Example.com" }, to: "Dad", from_line: "Kate", message: "For every inch\nyou farmed." }, extra || {}));
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return j;
}

test("issue: code format, check character, card link, never the code in a key", async () => {
  const { env, store } = makeEnv();
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const j = await issue(env);
    assert.match(j.code, /^RP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const s = j.code.replace(/^RP-|-/g, "");
    assert.equal(B32[checkOf(s.slice(0, 11))], s[11], "check character");
    assert.match(j.card_url, /^https:\/\/agsist\.com\/rp-gift\?c=RP-[0-9A-Z-]{14}&k=[0-9a-f]{16}$/);
    assert.equal(j.last4, j.code.slice(-4));
    assert.equal(j.no, i + 1);
    seen.add(j.code);
    for (const k of store.keys()) {
      assert.ok(!k.includes(j.code) && !k.includes(s), "code in a key: " + k);
    }
    for (const v of store.values()) assert.ok(!String(v).includes(j.code) && !String(v).includes(s), "code in a stored value");
  }
  assert.equal(seen.size, 40);
  const rec = JSON.parse(store.get([...store.keys()].find((k) => /^rpg:[0-9a-f]{16}$/.test(k))));
  assert.equal(rec.status, "issued");
  assert.equal(rec.giver.email, "kate@example.com");
  assert.ok(store.has("rpg-ref:RP-1042"));
  assert.ok([...store.keys()].some((k) => /^rpg-by:[0-9a-f]{16}$/.test(k)));
});

test("issue, void and find are Sig only, and only with a Bearer token", async () => {
  const { env } = makeEnv();
  const body = { product: "digital", order_ref: "X1" };
  assert.equal((await admin(env, "/rp-gift/issue", body, "nope")).status, 403);
  assert.equal((await W.fetch(new Request(H + "/rp-gift/issue?token=tok", { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" } }), env)).status, 403, "?token= is refused here");
  assert.equal((await pub(env, "/rp-gift/issue", body)).status, 403, "a public post with no token");
  assert.equal((await admin(env, "/rp-gift/void", { code: "RP-0000-0000-0000" }, "")).status, 403);
  assert.equal((await admin(env, "/rp-gift/find?order_ref=X1", null, "x")).status, 403);
  const noTok = makeEnv(); delete noTok.env.LIST_TOKEN;
  assert.equal((await admin(noTok.env, "/rp-gift/issue", body, "undefined")).status, 403, "no LIST_TOKEN set");
});

test("issue: refuses bad input and works out when a locked card ships", async () => {
  const { env } = makeEnv();
  const bad = [
    { product: "poster", order_ref: "A" }, { product: "digital" }, { product: "digital", order_ref: "has space" },
    { product: "digital", order_ref: "A", giver: { email: "nope" } }, { product: "digital", order_ref: "A", kind: "weird" },
    { product: "digital", order_ref: "A", kind: "locked" }, { product: "digital", order_ref: "A", lock: { design_code: "not a code!" } },
    { product: "digital", order_ref: "A", lock: { design_code: CODE, edit: "all" } }, { product: "digital", order_ref: "A", ships: "never" },
  ];
  for (const b of bad) assert.equal((await admin(env, "/rp-gift/issue", b)).status, 400, JSON.stringify(b));
  const thisYear = new Date().getFullYear();
  const cur = RP.encodeCode(Object.assign({}, DESIGN, { year: thisYear }));
  const j1 = await issue(env, { lock: { design_code: "GIFT-" + cur } });
  assert.equal(j1.ships, "january");
  const j2 = await issue(env, { lock: { design_code: CODE } });
  assert.equal(j2.ships, "now");
  const j3 = await issue(env);
  assert.equal(j3.ships, "now");
  const c = await (await pub(env, "/rp-gift/check", { code: j1.code })).json();
  assert.equal(c.kind, "locked");
  assert.equal(c.lock.design_code, cur, "GIFT- prefix dropped");
  const noSecret = makeEnv(); delete noSecret.env.UNSUB_SECRET;
  assert.equal((await admin(noSecret.env, "/rp-gift/issue", { product: "digital", order_ref: "A" })).status, 503, "no fallback secret");
});

test("check: typo tolerance, what a stranger sees, and unknown codes", async () => {
  const { env } = makeEnv();
  const j = await issue(env);
  const raw = j.code.replace(/^RP-|-/g, "");
  const typed = [j.code, j.code.toLowerCase(), raw, raw.toLowerCase(), " rp " + raw.slice(0, 4) + " " + raw.slice(4, 8) + " " + raw.slice(8) + " ",
    j.code.replace(/1/g, "l").replace(/0/g, "o"), j.code.replace(/1/g, "I").replace(/0/g, "O")];
  for (const t of typed) {
    const r = await pub(env, "/rp-gift/check", { code: t });
    const c = await r.json();
    assert.equal(r.status, 200, t);
    assert.equal(c.code, j.code);
    assert.deepEqual(Object.keys(c).sort(), ["code", "from_line", "kind", "lock", "ok", "prepaid", "product", "redeemed_on", "ships", "status", "to"]);
    assert.equal(c.to, "Dad"); assert.equal(c.from_line, "Kate"); assert.equal(c.status, "issued"); assert.equal(c.prepaid, false, "v5.40: an issued card is not prepaid");
    assert.ok(!JSON.stringify(c).includes("example.com") && !JSON.stringify(c).includes("every inch"), "no email or message");
  }
  // every single wrong character and every swap of neighbours fails the check
  let caught = 0, tried = 0;
  for (let i = 0; i < 12; i++) for (const ch of B32) {
    if (ch === raw[i]) continue;
    tried++;
    const t = raw.slice(0, i) + ch + raw.slice(i + 1);
    const s = t.slice(0, 11), ok = B32.indexOf(t[11]) === checkOf(s);
    if (!ok) caught++;
  }
  assert.equal(caught, tried, "one wrong character");
  for (let i = 0; i < 11; i++) {
    if (raw[i] === raw[i + 1]) continue;
    const t = raw.slice(0, i) + raw[i + 1] + raw[i] + raw.slice(i + 2);
    assert.notEqual(B32.indexOf(t[11]), checkOf(t.slice(0, 11)), "swap at " + i);
  }
  const wrong = raw.slice(0, 5) + (raw[5] === "A" ? "B" : "A") + raw.slice(6);
  assert.equal((await pub(env, "/rp-gift/check", { code: wrong })).status, 404);
  assert.equal((await pub(env, "/rp-gift/check", { code: "RP-UUUU-UUUU-UUUU" })).status, 404);
  assert.equal((await pub(env, "/rp-gift/check", {})).status, 404);
  // a well-formed code with a right check character that was never issued
  let fake = "ABCDEFGHJKM", c = checkOf(fake);
  while (c >= 32) { fake = fake.slice(0, 10) + B32[(B32.indexOf(fake[10]) + 1) % 32]; c = checkOf(fake); }
  assert.equal((await pub(env, "/rp-gift/check", { code: fake + B32[c] })).status, 404);
});

test("check and redeem: the public gate, the body cap and the rate table", async () => {
  const { env } = makeEnv();
  for (const p of ["/rp-gift/check", "/rp-gift/redeem"]) {
    const r1 = await W.fetch(new Request(H + p, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: "https://evil.example" } }), env);
    assert.equal(r1.status, 403, p + " origin");
    const r2 = await W.fetch(new Request(H + p, { method: "POST", body: "code=x", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://agsist.com" } }), env);
    assert.equal(r2.status, 415, p + " content type");
  }
  assert.equal((await pub(env, "/rp-gift/check", { code: "x".repeat(2000) })).status, 413);
  const src = read("workers/subs-worker.js");
  assert.match(src, /"\/rp-gift\/check": \[20, 60, 1000\], "\/rp-gift\/redeem": \[5, 10, 100\]/);
  assert.match(src, /"\/rp-gift\/check", "\/rp-gift\/redeem"\]\);/);
});

test("brute force: 10 unknown codes an hour from one address, then 429 even for a real code", async () => {
  const { env } = makeEnv();
  const j = await issue(env);
  const ip = "203.0.113.77";
  for (let i = 0; i < 10; i++) {
    const r = await pub(env, "/rp-gift/check", { code: "RP-0000-0000-000" + B32[i] }, ip);
    assert.equal(r.status, 404, "miss " + i);
  }
  assert.equal((await pub(env, "/rp-gift/check", { code: j.code }, ip)).status, 429, "check locked out");
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code), ip)).status, 429, "redeem locked out");
  assert.equal((await W.fetch(new Request(H + "/rp-gift/card?c=" + j.code + "&k=0000000000000000", { headers: { "CF-Connecting-IP": ip } }), env)).status, 429);
  assert.equal((await pub(env, "/rp-gift/check", { code: j.code }, "203.0.113.78")).status, 200, "another address is fine");
});

test("rate limit: 20 checks an hour from one address, hits included", async () => {
  const { env } = makeEnv();
  const j = await issue(env);
  const ip = "2001:db8:aa:bb::1";
  for (let i = 0; i < 20; i++) assert.equal((await pub(env, "/rp-gift/check", { code: j.code }, ip)).status, 200, "check " + i);
  assert.equal((await pub(env, "/rp-gift/check", { code: j.code }, "2001:db8:aa:bb::99")).status, 429, "same /64");
});

test("card: needs k; shows the message; a guessed code reads nothing", async () => {
  const { env } = makeEnv();
  const j = await issue(env);
  const u = new URL(j.card_url);
  const get = (q) => W.fetch(new Request(H + "/rp-gift/card?" + q, { headers: { Origin: "https://agsist.com", "CF-Connecting-IP": freshIp() } }), env);
  const r = await get(u.search.slice(1));
  const c = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(c.code, j.code); assert.equal(c.message, "For every inch\nyou farmed."); assert.equal(c.no, j.no);
  assert.ok(!JSON.stringify(c).includes("example.com"), "no giver email on the card");
  assert.equal((await get("c=" + j.code)).status, 404);
  assert.equal((await get("c=" + j.code + "&k=" + "0".repeat(16))).status, 404);
  assert.equal((await get("c=" + j.code + "&k=" + u.searchParams.get("k").toUpperCase())).status, 200, "k any case");
  const other = await issue(env);
  assert.equal((await get("c=" + other.code + "&k=" + u.searchParams.get("k"))).status, 404, "k is per code");
});

test("redeem: once; the order reaches the digest; a second redeem is 409 with the date", async () => {
  const { env, store } = makeEnv();
  const j = await issue(env);
  const r = await pub(env, "/rp-gift/redeem", order(j.code.toLowerCase(), { notes: "Barn wall" }));
  const o = await r.json();
  assert.equal(r.status, 200, JSON.stringify(o));
  assert.equal(o.choice, "framed12x18", "the card's product when none is chosen");
  assert.equal(o.upgrade, false);
  const forms = [...store.keys()].filter((k) => k.startsWith("form:rain-print-order:"));
  assert.equal(forms.length, 1);
  assert.match(forms[0], /^form:[a-z-]{2,30}:\d{10,16}:[0-9a-f]{8}$/, "the digest's key shape");
  const post = JSON.parse(store.get(forms[0]));
  assert.equal(post.kind, "rain-print-order");
  assert.equal(post.gift_card, "RP-\u2026-" + j.last4 + " (No. " + j.no + ")");
  assert.equal(post.gift_card_paid, "framed12x18");
  assert.equal(post.gift_card_order, "RP-1042");
  assert.equal(post.gift_card_from, "Kate");
  assert.equal(post.address, "123 Farm Rd, Chetek WI 54728");
  assert.ok(!JSON.stringify(post).includes(j.code), "the full code is not in the order");
  const again = await pub(env, "/rp-gift/redeem", order(j.code));
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /^This card was used on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
  const c = await (await pub(env, "/rp-gift/check", { code: j.code })).json();
  assert.equal(c.status, "redeemed");
  assert.match(c.redeemed_on, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  assert.equal([...store.keys()].filter((k) => k.startsWith("form:")).length, 1, "no second order");
});

test("redeem: the order rules apply (address for a print, email, design link)", async () => {
  const { env } = makeEnv();
  const j = await issue(env);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { address: "" }))).status, 400);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { email: "nope" }))).status, 400);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { design_url: "https://evil.example/x" }))).status, 400);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { choice: "poster" }))).status, 400);
  const c = await (await pub(env, "/rp-gift/check", { code: j.code })).json();
  assert.equal(c.status, "issued", "a refused redeem leaves the card unused");
  const d = await issue(env, { product: "digital" });
  const up = await (await pub(env, "/rp-gift/redeem", order(d.code, { choice: "print12x18" }))).json();
  assert.equal(up.upgrade, true, "digital card, print chosen: Sig emails a link for the difference");
  const dg = await issue(env, { product: "digital" });
  assert.equal((await pub(env, "/rp-gift/redeem", order(dg.code, { address: "" }))).status, 200, "a file needs no address");
});

test("redeem: a locked card takes only its design; edit name lets the name change", async () => {
  const { env, store } = makeEnv();
  const other = RP.encodeCode(Object.assign({}, DESIGN, { year: 2012 }));
  const renamed = RP.encodeCode(Object.assign({}, DESIGN, { name: "Grandpa Ray" }));
  const j = await issue(env, { lock: { design_code: CODE } });
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { design_code: other }))).status, 400);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { design_code: renamed }))).status, 400, "edit none: no new name");
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code))).status, 200);
  const n = await issue(env, { lock: { design_code: CODE, edit: "name" } });
  assert.equal((await pub(env, "/rp-gift/redeem", order(n.code, { design_code: other }))).status, 400, "edit name: the year stays");
  assert.equal((await pub(env, "/rp-gift/redeem", order(n.code, { design_code: renamed }))).status, 200);
  const thisYear = new Date().getFullYear();
  const cur = RP.encodeCode(Object.assign({}, DESIGN, { year: thisYear }));
  const x = await issue(env, { lock: { design_code: cur } });
  assert.equal((await pub(env, "/rp-gift/redeem", order(x.code, { design_code: cur, design_url: RP.designUrl(Object.assign({}, DESIGN, { year: thisYear })) }))).status, 200);
  const posts = [...store.keys()].filter((k) => k.startsWith("form:")).map((k) => JSON.parse(store.get(k)));
  const jan = posts.find((p) => p.gift_january === "yes");
  assert.ok(jan, "a January card's order is marked for January");
  assert.equal(jan.gift_to, "Dad");
});

test("redeem: pending blocks a second try; a stale pending frees the card", async () => {
  const { env, store } = makeEnv();
  const j = await issue(env);
  const key = [...store.keys()].find((k) => /^rpg:[0-9a-f]{16}$/.test(k));
  const rec = JSON.parse(store.get(key));
  store.set(key, JSON.stringify(Object.assign({}, rec, { status: "pending", pending_ts: Date.now(), redeem_key: "someone" })));
  const r = await pub(env, "/rp-gift/redeem", order(j.code));
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /being used right now/);
  store.set(key, JSON.stringify(Object.assign({}, rec, { status: "pending", pending_ts: Date.now() - 5 * 60e3, redeem_key: "someone" })));
  assert.equal((await (await pub(env, "/rp-gift/check", { code: j.code })).json()).status, "issued");
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code))).status, 200);
});

test("redeem: two at once on one edge, only one order", async () => {
  const { env, store } = makeEnv();
  const j = await issue(env);
  const rs = await Promise.all([pub(env, "/rp-gift/redeem", order(j.code)), pub(env, "/rp-gift/redeem", order(j.code))]);
  const st = rs.map((r) => r.status).sort();
  assert.deepEqual(st, [200, 409]);
  assert.equal([...store.keys()].filter((k) => k.startsWith("form:")).length, 1);
});

test("void: refuses a used card without force; reissue makes a new working code", async () => {
  const { env } = makeEnv();
  const j = await issue(env);
  const v = await (await admin(env, "/rp-gift/void", { code: j.code, reason: "lost", reissue: true })).json();
  assert.equal(v.ok, true); assert.equal(v.voided, j.last4);
  assert.match(v.code, /^RP-/); assert.notEqual(v.code, j.code);
  assert.match(v.card_url, /^https:\/\/agsist\.com\/rp-gift\?c=/);
  const old = await pub(env, "/rp-gift/redeem", order(j.code));
  assert.equal(old.status, 410);
  assert.equal((await (await pub(env, "/rp-gift/check", { code: j.code })).json()).status, "void");
  assert.equal((await admin(env, "/rp-gift/void", { code: j.code })).status, 409, "already void");
  const nc = await (await pub(env, "/rp-gift/check", { code: v.code })).json();
  assert.equal(nc.to, "Dad"); assert.equal(nc.product, "framed12x18");
  const card = await (await W.fetch(new Request(H + new URL(v.card_url).pathname.replace("/rp-gift", "/rp-gift/card") + new URL(v.card_url).search), env)).json();
  assert.equal(card.message, "For every inch\nyou farmed.", "the words carry over");
  assert.equal((await pub(env, "/rp-gift/redeem", order(v.code))).status, 200);
  assert.equal((await admin(env, "/rp-gift/void", { code: v.code })).status, 409, "used: needs force");
  assert.equal((await admin(env, "/rp-gift/void", { code: v.code, force: true, reason: "refund" })).status, 200);
  const f = await (await admin(env, "/rp-gift/find?order_ref=RP-1042")).json();
  assert.equal(f.cards.length, 2);
  assert.deepEqual(f.cards.map((c) => c.status), ["void", "void"]);
  assert.equal(f.cards[0].replaced_by, v.last4); assert.equal(f.cards[1].replaces, j.last4);
  const byMail = await (await admin(env, "/rp-gift/find?email=KATE@example.com")).json();
  assert.equal(byMail.cards.length, 2);
  assert.ok(!JSON.stringify(f).includes(j.code) && !JSON.stringify(f).includes(v.code), "find never answers a code");
  assert.equal((await admin(env, "/rp-gift/void", { key: "rpg:zzzz" })).status, 400);
});

test("issue already redeemed: the card only announces it", async () => {
  const { env } = makeEnv();
  const j = await issue(env, { already_redeemed: true });
  assert.equal(j.status, "redeemed");
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code))).status, 409);
});

test("the existing routes still answer: /rp-short and /form", async () => {
  const { env } = makeEnv();
  const r = await pub(env, "/rp-short", { code: CODE });
  assert.equal(r.status, 200);
  const f = await pub(env, "/form", { kind: "rain-print-order", name: "A", email: "a@example.com", choice: "digital", design_url: URL_, design_code: CODE });
  assert.equal(f.status, 200);
});

test("redeem: a lost race (a stale read at another edge) marks the second order gift_card_twice", async () => {
  const { env, store } = makeEnv();
  const j = await issue(env);
  const key = [...store.keys()].find((k) => /^rpg:[0-9a-f]{16}$/.test(k));
  const before = store.get(key);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code))).status, 200);
  store.set(key, before);   // the other edge still reads "issued"
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code))).status, 200);
  // Map order is write order; sorting the keys would let two posts in the same millisecond swap on their random suffix.
  const posts = [...store.keys()].filter((k) => k.startsWith("form:")).map((k) => JSON.parse(store.get(k)));
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => p.gift_card_twice || ""), ["", "yes"]);
});

test("the admin page can read Sig's answers (CORS for agsist.com), and the pages are noindex", async () => {
  const { env } = makeEnv();
  const r = await W.fetch(new Request(H + "/rp-gift/issue", { method: "POST", body: JSON.stringify({ product: "digital", order_ref: "A1" }),
    headers: { "Content-Type": "application/json", Authorization: "Bearer tok", Origin: "https://agsist.com" } }), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://agsist.com");
  const pre = await W.fetch(new Request(H + "/rp-gift/issue", { method: "OPTIONS", headers: { Origin: "https://agsist.com" } }), env);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  for (const p of ["rp-gift.html", "rp-gift-admin.html"]) {
    const h = read(p);
    assert.match(h, /<meta name="robots" content="noindex, nofollow">/, p);
    assert.match(h, /<meta name="referrer" content="no-referrer">/, p);
    assert.doesNotMatch(h, /googletagmanager|gtag\(/, p + ": no analytics");
    assert.doesNotMatch(read("sitemap.xml"), new RegExp("agsist\\.com/" + p.replace(".html", "") + "(<|\\.html)"), p + " not in the sitemap");
  }
  assert.doesNotMatch(read("rp-gift-admin.html"), /[?&]token=/, "the token never goes in a URL");
});

test("rp-gift.js: the same code rules as the worker, and the banner words", () => {
  const c = { TextEncoder, TextDecoder, URLSearchParams, atob, setTimeout, clearTimeout };
  c.window = c;
  vm.runInNewContext(read("components/rp-gift.js"), c);
  const G = c.AgRpGift;
  assert.equal(G.norm("rp 7k3m q9tw h2f4"), G.norm("RP-7K3M-Q9TW-H2F4"));
  let body = "7K3MQ9TWH2F", m = checkOf(body);
  while (m >= 32) { body = body.slice(0, 10) + B32[(B32.indexOf(body[10]) + 1) % 32]; m = checkOf(body); }
  const good = "RP-" + body.slice(0, 4) + "-" + body.slice(4, 8) + "-" + body.slice(8) + B32[m];
  assert.equal(G.norm(good.toLowerCase().replace(/-/g, " ")), good);
  assert.equal(G.norm(good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A")), "");
  const s = G.summary(CODE);
  assert.equal(s.place, "Chetek, WI"); assert.equal(s.year, 2025); assert.equal(s.name, "The Olson Farm"); assert.equal(s.style, "Roots");
  const open = G._state({ ok: true, kind: "open", product: "framed12x18", to: "Dad", from_line: "Kate", ships: "now", status: "issued" }, good);
  assert.equal(open.usable, true);
  assert.match(open.text, /^A gift from Kate: one framed 13 x 19 Rain Print, shipping included\. Pick the farm and the year/);
  const lk = G._state({ ok: true, kind: "locked", product: "print12x18", lock: { design_code: CODE, edit: "name" }, ships: "january", status: "issued" }, good);
  assert.deepEqual(lk.locked.includes("name"), false);
  assert.ok(lk.locked.includes("year") && lk.locked.includes("place"));
  assert.match(lk.text, /Your 2025 print comes in January/);
  const used = G._state({ ok: true, status: "redeemed", redeemed_on: "Dec 28, 2026" }, good);
  assert.equal(used.usable, false); assert.match(used.text, /used on Dec 28, 2026/);
  // A redeemed day sent as ISO (an older worker) still reads "Dec 26, 2026".
  assert.match(G._state({ ok: true, status: "redeemed", redeemed_on: "2026-12-26" }, good).text, /used on Dec 26, 2026\./);
  assert.equal(G.dayText("2026-01-05"), "Jan 5, 2026");
  assert.equal(G.dayText("Dec 28, 2026"), "Dec 28, 2026");
  // Sig speaks for himself on the Rain Print page, and the promises match the page's.
  const v = G._state({ ok: true, status: "void" }, good).text;
  assert.equal(v, "This card is no longer active. Write to me at sig@farmers1st.com and I’ll sort it out.");
  assert.equal(G.errorText({ status_code: 0 }), "The gift card check didn’t answer. Try again in a minute.");
  assert.equal(G.errorText({ status_code: 503 }), "The gift card check didn’t answer. Try again in a minute.");
  assert.match(lk.text, /comes in January, once the full year is in\.$/);
  const now = G.doneHtml({ code: good }, { ships: "now" });
  assert.match(now, /I have your order and will email you a proof within 1 business day\./);
  const jan = G.doneHtml({ code: good }, { ships: "january", upgrade: true });
  assert.match(jan, /a proof in January, once the full year is in\./);
  // 2026-10-14 (Sig): the digital file has no proof step
  const file = G.doneHtml({ code: good, product: "framed12x18" }, { ships: "now" }, "digital");
  assert.match(file, /will email you the finished file within 1 business day\. If you want anything changed, write to me and I’ll fix it or redo it by hand and send it again, no charge\./);
  assert.doesNotMatch(file, /proof/);
  assert.match(G.doneHtml({ code: good, product: "digital" }, { ships: "january" }), /the finished file in January, once the full year is in\./, "the card's product when no choice is given");
  assert.match(G.doneHtml({ code: good, product: "digital" }, { ships: "now" }, "print12x18"), /a proof within 1 business day\./, "an upgrade to a print gets the proof");
  assert.match(jan, /so I’ll email you a link for the difference\./);
  for (const t of [now, jan, v]) assert.doesNotMatch(t, /\bSig (has|will)\b|last rain is in|within a day/);
  assert.equal(G._state({ ok: false, status_code: 429 }, good).usable, false);
  for (const f of ["components/rp-gift.js", "rp-gift.html"]) assert.doesNotMatch(read(f), /—/, f + ": no em dashes");
});

test("rp-gift.html: the card's words (station, marked days, full year, card number, trim)", () => {
  const h = read("rp-gift.html");
  // The marked-days phrase, run from the page's own function.
  const src = h.match(/function marked\(d\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "marked() is on the card page");
  const marked = new Function(src[0] + "; return marked;")();
  assert.equal(marked([]), "");
  assert.equal(marked(["Planted"]), ", with one day marked: Planted");
  assert.equal(marked(["Planted", "Hail"]), ", with two days marked: Planted and Hail");
  assert.equal(marked(["Planted", "Hail", "Harvest done"]), ", with three days marked: Planted, Hail and Harvest done");
  assert.match(h, /esc\(marked\(s\.dates\)\)/, "the lede uses it");
  assert.match(h, /Any farm, any year on record/);
  assert.match(h, /NOAA weather station nearest/);
  assert.match(h, /nearest NOAA weather station, drawn day by day/);
  assert.doesNotMatch(h, /NOAA gauge|since 1890|last rain is in|print on letter and trim/);
  assert.equal((h.match(/once the full year is in\./g) || []).length, 6, "both January lines on the small cards, and the 8 x 10's what's-coming lines");
  assert.match(h, /Your ' \+ s\.year \+ ' print comes in January, once the full year is in\./);
  assert.match(h, /framed12x18: \['A print of the whole year in a 13 x 19 black frame with a white mat and glass, ready to hang\.', 'It ships in January, once the full year is in\.'\]/);
  assert.match(h, /print12x18: \['A print of the whole year on 13 x 19 heavy, textured cotton fine-art paper\.', 'It ships in January, once the full year is in\.'\]/);
  assert.match(h, /digital: \['The 12 x 18 digital file of the whole year, to print anywhere\.', 'It comes by email in January, once the full year is in\.'\]/);
  assert.equal((h.match(/class="foot">Card ' \+ String\(C\.no/g) || []).length, 3, "every foot says Card 0017 (the small cards' two and the 8 x 10's)");
  assert.doesNotMatch(h, /class="foot">No\. /);
  assert.match(h, /\.sz-half \.cut\.t\{top:\.3in\}\.sz-half \.cut\.b\{bottom:\.3in\}/, "cut marks clear of a printer's unprintable edge");
  assert.match(h, /G\.dayText\(j\.redeemed_on\)/);
  assert.match(h, /<script src="\/components\/rp-gift\.js\?v=\d+"><\/script>/, "the card page loads a versioned script");
});

/* The 8 x 10 card (2026-10-14, Sig): the default size, on letter with cut marks,
   and the print so far drawn by the page's own engine and art. */
test("rp-gift.html: 8 x 10 is the default, and the print sizes are right for 8 x 10 and letter", () => {
  const h = read("rp-gift.html");
  assert.match(h, /<style id="page-size">@page\{size:8in 10in;margin:0\}<\/style>/, "the page prints 8 x 10 before anything is picked");
  assert.match(h, /<body class="sz-8x10">/);
  assert.match(h, /var C = null, size = '8x10'/, "the script starts on 8 x 10");
  assert.match(h, /var SIZE_KEY = 'agsist-rpg-size2';/, "an older stored 5 x 7 pick doesn't hide the new default");
  assert.match(h, /<button type="button" data-size="8x10" aria-pressed="true">8 x 10 card<\/button>/);
  assert.match(h, /<button type="button" data-size="8x10l" aria-pressed="false">8 x 10 on letter paper<\/button>/);
  const sizes = {};
  for (const m of h.matchAll(/'?([0-9a-z]+)'?: \['([0-9.]+in [0-9.]+in)', /g)) sizes[m[1]] = m[2];
  assert.deepEqual(sizes, { "8x10": "8in 10in", "8x10l": "8.5in 11in", "5x7": "5in 7in", half: "11in 8.5in", letter: "8.5in 11in" }, "every size prints on its own page size");
  assert.match(h, /\$\('page-size'\)\.textContent = '@page\{size:' \+ SIZES\[size\]\[0\] \+ ';margin:0\}';/);
  assert.match(h, /\.sz-8x10 \.sheet\{width:8in;height:10in\}/);
  assert.match(h, /\.sz-8x10l \.sheet\{width:8\.5in;height:11in\}/);
  assert.match(h, /\.sz-8x10l \.c8\{position:absolute;left:\.25in;top:\.5in;width:8in;height:10in\}/, "the 8 x 10 sits in the middle of the letter sheet");
  // the cut marks: on the card's edges, never nearer than 0.3 in to the top or bottom of the sheet, nor to the side they run from
  const marks = h.match(/function marks\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(marks, /\[\.25, 8\.25\]\.forEach/);
  assert.match(marks, /top:\.3in/); assert.match(marks, /bottom:\.3in/);
  assert.match(marks, /\[\.5, 10\.5\]\.forEach/);
  assert.match(marks, /left:\.3in/); assert.match(marks, /right:\.3in/);
  assert.match(h, /size === '8x10l' \? '<div class="sheet">' \+ card8\(\) \+ marks\(\) \+ '<\/div>'/);
  // the 8 x 10 says what's coming, never a price, and speaks of Sig in the third person
  const c8 = h.match(/function card8\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(c8 + h.match(/var COMING = \{[\s\S]*?\};/)[0], /\$|price/i);
  assert.match(c8, /'Made' : 'Drawn and printed'\) \+ ' by Sig Lindquist, AGSIST, Chetek, Wisconsin/);
  assert.match(c8, /<p class="to">For ' \+ esc\(C\.to\)/);
  assert.match(c8, /C\.message/); assert.match(c8, /C\.code/);
  assert.match(h, /function later\(year\) \{ return 'The rest of ' \+ year \+ ' arrives in January'; \}/);
  // print waits for the preview, drawn or failed
  assert.match(h, /return loadPreview\(\)\.then\(function \(\) \{ \$\('print'\)\.disabled = false; render\(\); \}\);/);
  assert.match(h, /<script src="\/components\/rain-print-art\.js\?v=\d+"><\/script>\n<script src="\/components\/rain-print\.js\?v=\d+"><\/script>/, "the page's own engine and art, versioned");
});

// a pretend NOAA for previewArt: a station reporting 2026 through Oct 9, with a few days missing
function fakeNoaa(opts = {}) {
  const days = [];
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 9, 9); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const row = (d, i) => [d, i % 17 === 3 ? "M" : i % 5 === 0 ? (0.1 + (i % 7) * 0.12).toFixed(2) : "0.00", "50", "0.0", "60", "40"];
  return (url) => {
    const u = new URL(url);
    const json = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    if (opts.down) return Promise.reject(new TypeError("Failed to fetch"));
    if (u.hostname.startsWith("geocoding-api")) return json({ results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] });
    if (u.searchParams.get("params")) return json({ data: days.concat(["2026-12-31"]).map((d) => [d, "0.08"]) });
    // NOAA sends what has come in up to the end date asked for (the engine asks through today)
    if (u.pathname === "/StnData") return json({ meta: { name: "CHETEK", state: "WI", ll: [-91.65, 45.32] }, data: days.map(row).filter((x) => x[0] <= (u.searchParams.get("edate") || "9999")) });
    return json({});
  };
}
function engineAt(todayIso, fetchFn) {
  const fixed = Date.parse(todayIso + "T18:00:00Z");
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }
  const c = { TextEncoder, TextDecoder, URLSearchParams, URL, btoa, atob, Intl, Promise, setTimeout, clearTimeout, AbortController, Map, fetch: fetchFn, Date: FixedDate };
  c.window = c;
  for (const f of ["components/qr.js", "components/rain-print-art.js", "components/rain-print.js"]) vm.runInNewContext(read(f), c);
  return c;
}
const GIFT_DESIGN = { place: "Chetek, WI", station: "471667 2", year: 2026, style: "r1", name: "The Johnson Farm", cmp: "normal",
  markers: [{ date: "2026-05-08", label: "Planted" }, { date: "2026-11-20", label: "After" }] };

test("previewArt: the card's print so far, through the last reported day, the months to come marked", async () => {
  const c = engineAt("2026-10-14", fakeNoaa());
  const code = c.RainPrint.encodeCode(GIFT_DESIGN);
  const r = await c.RainPrint.previewArt(code, { idPrefix: "gc", later: "The rest of 2026 arrives in January" });
  assert.equal(r.last, "2026-10-09", "the last reported day");
  assert.equal(r.preview, true);
  assert.equal(r.year, 2026);
  assert.equal(r.place, "Chetek, Wisconsin");
  assert.equal(r.days, 282, "January 1 through October 9");
  assert.match(r.svg, /^<svg /);
  // Sig, 2026-10-20: nothing covers the data; the card's own wash note holds the weeks still to come, so no band
  assert.doesNotMatch(r.svg, /data-rp="band"/, "no preview band over the card's print");
  assert.match(r.svg, /<title id="gcT">Chetek, Wisconsin, 2026, rain print, preview through Oct 9<\/title>/);
  const later = r.svg.match(/<g data-rp="later" aria-hidden="true"><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*\/>([\s\S]*?)<\/g>/);
  assert.ok(later, "the months still to come are washed pale");
  const x0 = +later[1], x1 = x0 + +later[2];
  // (Staircase A2 clean, 2026-10-17: the chart runs from 196 to 1590, the line ends' words to its right)
  assert.ok(Math.abs(x0 - (196 + 282 * (1590 - 196) / 365)) < 0.01 && Math.abs(x1 - 1590) < 0.01, "from the day after Oct 9 to Dec 31 on the full calendar: " + x0 + " to " + x1);
  assert.match(later[3].replace(/<[^>]+>/g, "|"), /The rest of 2026\|+arrives in January/, "with the words in it");
  assert.match(r.svg, />Planted</, "a date already past is on it");
  assert.doesNotMatch(r.svg, />After</, "a date still to come is not");
  // the same engine on the page draws no wash: the page never passes later
  const page = await c.RainPrint.previewArt(code, { idPrefix: "pg" });
  assert.doesNotMatch(page.svg, /data-rp="later"/);
  // a design with no station takes the nearest good one, as the page does
  const c2 = engineAt("2026-10-14", (url) => /StnMeta/.test(url)
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ meta: [{ name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" }] }) })
    : fakeNoaa()(url));
  const r2 = await c2.RainPrint.previewArt(c2.RainPrint.encodeCode({ ...GIFT_DESIGN, station: "", style: "r2" }), { later: "The rest of 2026 arrives in January" });
  assert.equal(r2.station, "471667 2");
  assert.match(r2.svg, /data-rp="later"/, "Roots marks the months to come too");
});

test("previewArt: no fair preview, no art; the card falls back to the empty month line", async () => {
  const code = engineAt("2026-10-14", fakeNoaa()).RainPrint.encodeCode(GIFT_DESIGN);
  await assert.rejects(engineAt("2026-10-14", fakeNoaa({ down: true })).RainPrint.previewArt(code), /couldn.t be reached/, "NOAA down");
  await assert.rejects(engineAt("2026-02-10", fakeNoaa()).RainPrint.previewArt(code), /Only 41 days of 2026 are in so far\./, "too little of the year to draw fairly");
  await assert.rejects(engineAt("2026-10-14", fakeNoaa()).RainPrint.previewArt("nope"), /doesn.t open/);
  const h = read("rp-gift.html");
  assert.match(h, /PV = null; PV_STATE = 'failed';/);
  assert.match(h, /if \(s && PV\) \{[\s\S]*?\} else if \(s\) \{[\s\S]*?o \+= '<div class="art">' \+ axis\(\) \+ '<\/div>';/, "no preview: the axis-only card");
  assert.match(h, /so the card shows the empty month line instead\. It still prints and works the same\./, "a plain note for Sig, on screen only");
  assert.match(h, /<p id="pvnote" hidden><\/p>/);
  assert.ok(h.indexOf('id="pvnote"') < h.indexOf('id="msg"') && /<div class="bar noprint">[\s\S]*id="pvnote"[\s\S]*?<\/div>/.test(h), "the note is in the bar, which never prints");
});

// ---------- 2026-10-15: long designs, Stripe ids, the logo ----------
test("v5.26 redeem: a locked card takes its long design sent as RPS-<id>, expanded from the short link before comparing", async () => {
  const { env, store } = makeEnv();
  const LONG = Object.assign({}, DESIGN, { name: "The Olson Family Farm", dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
    markers: [{ date: "2025-05-08", label: "Planted beans" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-24", label: "Harvest done" }] });
  const long = RP.encodeCode(LONG);
  assert.ok(long.length > 200, "a design past Stripe's 200 letters");
  store.set("rps:K7Q2M", long);
  const j = await issue(env, { lock: { design_code: long } });
  const other = RP.encodeCode(Object.assign({}, LONG, { year: 2012 }));
  store.set("rps:Z9Z9Z", other);
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { design_code: "RPS-Z9Z9Z" }))).status, 400, "another design's short link is still refused");
  assert.equal((await pub(env, "/rp-gift/redeem", order(j.code, { design_code: "RPS-NOPE1" }))).status, 400, "an unknown id is refused");
  const r = await pub(env, "/rp-gift/redeem", order(j.code, { design_code: "RPS-K7Q2M" }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const post = [...store.keys()].filter((k) => k.startsWith("form:rain-print-order:")).map((k) => JSON.parse(store.get(k))).pop();
  assert.equal(post.design_code, "RPS-K7Q2M", "the order keeps the reference Sig opens");
});

test("v5.26 issue: order_ref takes Stripe's ids (underscores, up to 80)", async () => {
  const { env } = makeEnv();
  for (const ref of ["pi_3QxYzAbCdEfGhIjK0aBcDeF", "cs_live_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123456789abcdefghijABCDEFGH"]) {
    assert.ok(ref.length <= 80);
    const j = await issue(env, { order_ref: ref });
    assert.equal(j.ok, true, ref);
  }
  assert.equal((await admin(env, "/rp-gift/issue", { product: "digital", order_ref: "_starts_with_underscore" })).status, 400);
  assert.equal((await admin(env, "/rp-gift/issue", { product: "digital", order_ref: "A".repeat(81) })).status, 400);
});

test("the page sends the logo with a redeem; the admin page looks up an RPS- design before locking a card", () => {
  const G = read("components/rp-gift.js");
  assert.match(G, /\['name', 'email', 'address', 'notes', 'design_url', 'design_code', 'choice', 'page', 'logo'\]/);
  const A = read("rp-gift-admin.html");
  assert.match(A, /function fullCode\(dc\)[\s\S]*?\/rp-short\/' \+ encodeURIComponent/);
  assert.match(A, /fullCode\(raw\)\.then/);
  assert.match(read("components/rain-print.js"), /if \(GIFT && GIFT\.lock && GIFT\.lock\.design\) \{\s*var gl = new Error\('NOAA didn\\u2019t send the station on your gift card/, "a gift card's station is never quietly swapped");
});
