/* The subs worker's new home (Oct 22, 2026): agsist-api.dnilgis.workers.dev.
 *
 * Cloudflare blocked agsist-subs.dnilgis.workers.dev on Oct 21 and support
 * said a new Worker on the account is Sig's call. The same code deploys as
 * the Worker agsist-api (workers/wrangler.api.toml, the same KV store).
 *   - the two wrangler files differ only in the name;
 *   - no live file names the old host: only the lines listed below may
 *     (guard fixtures that prove an email naming it is refused, the both-hosts
 *     allow lists, the old Worker's own wrangler file, history);
 *   - the signup backup (loader.js) and the outbox take either host, and the
 *     outbox sends a kept item to the new one;
 *   - with a fresh UNSUB_SECRET, a stop link signed with the old one still
 *     tells the reader how to stop, changes nothing, and a confirm link with
 *     the old secret is still refused as before.
 *
 *   node --test test/new-worker-host.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const NEW = "https://agsist-api.dnilgis.workers.dev";

test("wrangler.api.toml is wrangler.subs.toml with the new name", () => {
  const conf = (s) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const api = conf(read("workers/wrangler.api.toml")), subs = conf(read("workers/wrangler.subs.toml"));
  assert.equal(api[0], 'name = "agsist-api"');
  assert.equal(subs[0], 'name = "agsist-subs"', "the old Worker's build file is unchanged");
  assert.deepEqual(api.slice(1), subs.slice(1), "same main, date, keep_vars and KV binding");
  assert.ok(api.includes("keep_vars = true") && api.includes('binding = "SUBS"'));
  assert.match(read("workers/README.md"), /npx wrangler@4\.149\.0 deploy --config wrangler\.api\.toml/);
});

// file -> the lines that may still name the old host (any spelling: plain, upper case, regex-escaped)
const OLD_RE = /agsist-subs(?:\\?\.)dnilgis(?:\\?\.)workers(?:\\?\.)dev/i;
const ALLOWED = {
  "workers/README.md": [/old host|agsist-subs\.dnilgis\.workers\.dev\/rp-order\/stripe/i],
  "sw.js": [/^\s*'agsist-subs\.dnilgis\.workers\.dev',\s+\/\/ the subs worker \(old home/],
  "data/audit-expected.json": [/^\s*"match": "agsist-subs\.dnilgis\.workers\.dev\/",$/],
  "components/loader.js": [/^\s*var HOSTS = \{ 'agsist-api\.dnilgis\.workers\.dev': 1, 'agsist-subs\.dnilgis\.workers\.dev': 1 \};$/],
  // the email guard's own selftests: an email naming the old host is refused
  "scripts/email_links.py": [/./],
  "scripts/daily_v2.py": [/ok\(shared_host\("https:\/\/agsist-subs\.dnilgis\.workers\.dev\/u\?k=1"\)/],
  "scripts/test_daily_v2.py": [/b = build\(d21, unsub_url="https:\/\/agsist-subs\.dnilgis\.workers\.dev\/unsubscribe/],
  "scripts/brief_email.py": [/^\s+\(?"https:\/\/agsist-subs\.dnilgis\.workers\.dev\/unsubscribe\?k=0123456789abcdef&t=ab"/],
  "test/email-links.test.mjs": [/m\.set_content\('see https:\/\/agsist-subs|L\.signed\('https:\/\/agsist-subs/,
    /^\s+"brief_email\.py": \[\/\^/],   // the allow list for the brief_email.py fixture above
  // what happened on Oct 21, in comments
  "test/fixtures/rp-chetek-oct21.mjs": [/^\s*\* worker blocked the way Cloudflare blocked agsist-subs/],
  "test/rain-print-outage.test.mjs": [/^\s*\* after Oct 21 2026: Cloudflare blocked agsist-subs/],
  "test/signup-fallback.test.mjs": [/^\s*\* Oct 21: Cloudflare answered agsist-subs/],
  "test/new-worker-host.test.mjs": [/./],
};

test("no live file names the old worker host except the allowed lines", () => {
  const out = execFileSync("git", ["grep", "-n", "-I", "-i", "-E", "agsist-subs\\\\?\\.dnilgis\\\\?\\.workers\\\\?\\.dev"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  const hits = out.split("\n").filter(Boolean);
  assert.ok(hits.length > 0, "the guard fixtures name the old host, so git grep finds something");
  for (const h of hits) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(h);
    assert.ok(m, h);
    const [, f, n, line] = m;
    assert.ok(OLD_RE.test(line), h);
    assert.ok((ALLOWED[f] || []).some((re) => re.test(line)), f + ":" + n + " still names the old host: " + line.trim().slice(0, 140));
  }
});

test("pages and components call the new host", () => {
  for (const f of ["e.html", "r.html", "R.html", "status.html", "components/rp-short.js", "components/signup-ask.js",
    "components/ga-gate.js", "components/form-post.js", "components/rain-print.js", "farmland-atlas/watch.js"]) {
    assert.ok(read(f).includes("agsist-api.dnilgis.workers.dev"), f);
  }
  assert.ok(read("scripts/build_atlas_pages.py").includes("var U='" + NEW + "/watch-subscribe'"), "the Atlas watch script builder");
  assert.ok(read("farmland-atlas/watch.js").startsWith("(function(){var U='" + NEW + "/watch-subscribe'"));
  const sw = read("sw.js");
  assert.match(sw, /var CACHE_VERSION = 233;/);
  assert.ok(sw.includes("'agsist-api.dnilgis.workers.dev',") && sw.includes("'workers.dev',"), "never cached, either host");
  const ex = JSON.parse(read("data/audit-expected.json")).expected.map((e) => e.match);
  assert.ok(ex.includes("agsist-api.dnilgis.workers.dev/") && ex.includes("agsist-subs.dnilgis.workers.dev/"), "status ping expected on either host");
  assert.match(read("workers/subs-worker.js"), /^ \* v5\.52 \(2026-10-22\): NEW HOME, agsist-api\.dnilgis\.workers\.dev/m);
});

test("outbox: takes either host, sends a kept item to the new one", async () => {
  const m = new Map();
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const c = { localStorage: ls, sessionStorage: ls, setTimeout, clearTimeout, JSON, Promise, Date, Math, URLSearchParams, AbortController };
  c.window = c;
  const calls = [];
  c.fetch = async (u) => { calls.push(u); return { status: 200, ok: true, json: async () => ({ ok: true }) }; };
  vm.runInNewContext(read("components/outbox.js"), c);
  assert.ok(c.AgOutbox.add({ url: "https://agsist-subs.dnilgis.workers.dev/hay/post", body: { a: 1 }, label: "old" }));
  assert.ok(c.AgOutbox.add({ url: NEW + "/elev/save", body: { b: 1 }, label: "new" }));
  assert.equal(c.AgOutbox.add({ url: "https://agsist-evil.dnilgis.workers.dev/x", body: {} }), "", "no other worker");
  assert.equal(c.AgOutbox.add({ url: "https://agsist-subs.dnilgis.workers.dev.evil.example/x", body: {} }), "", "no look-alike host");
  await c.AgOutbox.flush({ quiet: true });
  assert.deepEqual(calls, [NEW + "/hay/post", NEW + "/elev/save"]);
});

test("signup backup in loader.js watches either host", () => {
  const L = read("components/loader.js");
  assert.ok(L.includes("var HOSTS = { 'agsist-api.dnilgis.workers.dev': 1, 'agsist-subs.dnilgis.workers.dev': 1 };"));
  assert.ok(L.includes("return HOSTS[x.host] === 1 && LISTS[x.pathname]"));
});

// ---------- a fresh UNSUB_SECRET on the new Worker ----------
async function worker() {
  const tmp = join(tmpdir(), "subs-worker-newhost-" + process.pid + ".mjs");
  copyFileSync(ROOT + "workers/subs-worker.js", tmp);
  try { return (await import(pathToFileURL(tmp).href)).default; } finally { unlinkSync(tmp); }
}

test("a stop link signed with the old secret: the way to stop, nothing changed; an old confirm link: refused as before", async () => {
  const w = await worker();
  const store = new Map();
  const kv = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
  const env = { UNSUB_SECRET: "fresh-secret", LIST_TOKEN: "tok", SUBS: kv };
  const oldT = (s) => crypto.createHmac("sha256", "old-secret").update(s.toLowerCase()).digest("hex").slice(0, 16);
  const E = "made-up-reader@example.com", L = "abcdefghjkmnpqrs";
  store.set("lid:" + L, E);
  store.set("sub:" + E, JSON.stringify({ ts: 1760000000000, src: "hero" }));
  store.set("alert:" + E, JSON.stringify({ lat: 45, lon: -91, place: "x", radius_mi: 5, ts: 1 }));
  store.set("note:" + E, JSON.stringify({ t: { "rent:wi": { ts: 1, src: "x" } } }));
  const snap = () => JSON.stringify([...store.entries()].filter(([k]) => !k.startsWith("rl")).sort());
  const before = snap();
  let ip = 0;
  const go = (p, method = "GET") => w.fetch(new Request(NEW + p, { method,
    headers: { "CF-Connecting-IP": "10.9.0." + (++ip), Origin: "https://agsist.com" } }), env);
  const friendly = (h) => h.includes("That unsubscribe link no longer works.") &&
    h.includes('href="mailto:news@agsist.com?subject=unsubscribe"') && h.includes("Nothing was changed.") && !h.includes(E);

  for (const route of ["/unsubscribe", "/alert-unsubscribe", "/notice-unsubscribe", "/watch-unsubscribe",
    "/elevator-watch-unsubscribe", "/price-watch-unsubscribe"]) {
    for (const method of ["GET", "POST"]) {
      let r = await go(route + "?k=" + L + "&t=" + oldT(L), method);
      let h = await r.text();
      assert.equal(r.status, 403, route + " k= " + method + ": status as before");
      assert.ok(friendly(h), route + " k= " + method + ": the way to stop");
      r = await go(route + "?e=" + encodeURIComponent(E) + "&t=" + oldT(E), method);
      h = await r.text();
      assert.equal(r.status, 200, route + " e= " + method + ": status as before");
      assert.ok(friendly(h), route + " e= " + method + ": the way to stop, no address on the page");
    }
  }
  let r = await go("/rp-remind/stop?k=x&t=" + oldT("x"));
  assert.ok(friendly(await r.text()), "/rp-remind/stop: the way to stop");
  assert.equal(snap(), before, "nothing changed");

  // through the agsist.com front door: JSON the page can read, never the address
  r = await go("/fd/unsubscribe?k=" + L + "&t=" + oldT(L));
  const x = await r.json();
  assert.equal(r.status, 200);
  assert.equal(x.ok, false, "the page adds its own stop line on ok:false");
  assert.equal(x.title, "That unsubscribe link no longer works.");
  assert.ok(x.lines.some((l) => /Older AGSIST links stop working/.test(l)) && !JSON.stringify(x).includes(E));

  // a confirm link is not a stop link: refused as before
  r = await go("/watch-confirm?e=" + encodeURIComponent(E) + "&f=55005&t=" + oldT(E + "|c|55005"), "POST");
  const h = await r.text();
  assert.ok(h.includes("That link isn't valid.") && !h.includes("no longer works"), "confirm: refused as before");
  assert.equal(snap(), before, "still nothing changed");

  // and a link signed with the fresh secret works
  const newT = (s) => crypto.createHmac("sha256", "fresh-secret").update(s.toLowerCase()).digest("hex").slice(0, 16);
  r = await go("/unsubscribe?k=" + L + "&t=" + newT(L), "POST");
  await r.text();
  assert.equal(r.status, 200);
  assert.ok(!store.has("sub:" + E), "a fresh link unsubscribes");
});
