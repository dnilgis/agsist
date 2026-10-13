/* The bid email box (components/cb-signup.js) on /cash-bids and the town
 * pages. It posts to two routes that already exist, so what is proved here is
 * that its bodies are the ones those routes and their mailers already take:
 *   - its ZIP price alert hashes and reads exactly like cb-alerts.js zipPanel()
 *     (the one scripts/send_zip_alert.py mails), and the worker stores it;
 *   - its morning email is a plain /subscribe with the ZIP, as every Daily ask.
 * The worker runs against an in-memory KV, as scripts/test_elevator_watch.mjs
 * does. No network.
 *
 *   node --test test/cb-signup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, "utf8");

function load(file) {
  const doc = { readyState: "complete", addEventListener() {}, querySelectorAll: () => [], getElementById: () => null };
  const win = { document: doc };
  win.window = win;
  vm.runInNewContext(read(file), win);
  return win;
}

const S = load("components/cb-signup.js").CBSignup;
const A = load("components/cb-alerts.js").CBAlerts;

test("the box hashes exactly like cb-alerts.js", () => {
  for (const parts of [["ab50830025", "cash", "nearby", "above:450"], ["IA", "Heartland Co-op", "Afton", "corn"],
    ["NE", "Öl & Söhne", "", "soybeans"], ["", "", "", ""]]) {
    assert.equal(S._widFor(...parts), A._widFor(...parts), parts.join("|"));
  }
});

test("the price alert body is zipPanel()'s body at 25 mi", () => {
  const b = JSON.parse(JSON.stringify(S._alertBody("a@x.com", "50830", "soybeans", 1050)));  /* out of the vm realm */
  assert.deepEqual(b, {
    email: "a@x.com", kind: "cash", ewid: "ab50830025", crop: "soybeans", period: "nearby", plabel: "nearest delivery",
    direction: "above", target_cents: 1050,
    label: "Soybeans at or above $10.50 within 25 mi of ZIP 50830",
    wid: A._widFor("ab50830025", "cash", "nearby", "above:1050"),
  });
  // zipPanel() builds the same ewid, period and wid; 25 is one of its radii
  const cba = read("components/cb-alerts.js");
  assert.ok(cba.includes("ewid = 'ab' + zip + ('00' + mi).slice(-3)"));
  assert.ok(cba.includes("wid:widFor(ewid, 'cash', 'nearby', 'above:' + cents)"));
  assert.match(cba, /var RADII = \[[^\]]*\b25\b/);
  // and send_zip_alert.py / send_elevator_watch.py read it as a ZIP alert
  assert.ok(read("scripts/send_elevator_watch.py").includes('ZIP_EWID = re.compile(r"^ab(\\d{5})(\\d{3})$")'));
  assert.match(b.ewid, /^ab(\d{5})(\d{3})$/);
});

test("the worker takes both posts as they are today", async () => {
  const src = path.join(ROOT, "workers", "subs-worker.js");
  const tmp = path.join(os.tmpdir(), "subs-worker-under-test-cbsignup.mjs");
  fs.copyFileSync(src, tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  const store = new Map();
  const env = {
    UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
      async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
    },
  };
  const call = (p, b) => w.fetch(new Request("https://x.dev" + p, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://agsist.com" }, body: JSON.stringify(b),
  }), env);

  const body = S._alertBody("A@x.com", "50830", "corn", 450);
  let r = await call("/elevator-watch-subscribe", body);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  const rec = JSON.parse(store.get("ewatch:a@x.com"));
  const p = rec.pend[body.wid];
  assert.ok(p && p.m === 0, "pending, unmailed: the confirm email still goes first");
  assert.equal(p.kind, "cash");
  assert.equal(p.ewid, "ab50830025");
  assert.equal(p.target_cents, 450);
  assert.equal(p.direction, "above");

  r = await call("/subscribe", { email: "b@x.com", source: "town:iowa/afton", reports: true, zip: "50830" });
  assert.equal(r.status, 200);
  const sub = JSON.parse(store.get("sub:b@x.com"));
  assert.equal(sub.zip, "50830");
  assert.equal(sub.src, "town:iowa/afton");
});

test("pages load the box once and point it at a ZIP", () => {
  const cb = read("cash-bids.html");
  assert.equal((cb.match(/\/components\/cb-signup\.js\?v=\d+/g) || []).length, 1);
  assert.equal((cb.match(/\/components\/cb-signup\.css\?v=\d+/g) || []).length, 1);
  assert.match(cb, /<div data-bid-alerts data-zip-input="cb-zip" data-source="page:cash-bids"/);
  assert.ok(cb.indexOf('id="best-bids-section"') < cb.indexOf("data-bid-alerts")
    && cb.indexOf("data-bid-alerts") < cb.indexOf('id="cb-results"'), "under the best prices, above the list");
  assert.ok(!cb.includes("data-signup-ask="), "one email ask on /cash-bids");
});
