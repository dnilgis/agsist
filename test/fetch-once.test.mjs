/* AG.json / AG.text (components/util.js): one request per file for the life
 * of the page, each caller with its own parsed copy, and a failure that is not
 * kept. Runs the shipped util.js in a bare context with a counting fetch.
 *
 *   node --test test/fetch-once.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = readFileSync(ROOT + "components/util.js", "utf8");

function page(responder) {
  const calls = [];
  const ctx = {
    window: {},
    fetch: (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve(responder(url, calls.length));
    },
  };
  vm.runInNewContext(SRC, ctx);
  return { AG: ctx.window.AG, calls };
}
const ok = (body) => ({ ok: true, status: 200, text: () => Promise.resolve(body) });
const miss = () => ({ ok: false, status: 404, text: () => Promise.resolve("") });

test("three readers of one file make one request", async () => {
  const { AG, calls } = page(() => ok('{"quotes":{"corn":{"close":480.5}}}'));
  const [a, b, c] = await Promise.all([AG.json("/data/prices.json"), AG.json("/data/prices.json"), AG.json("/data/prices.json")]);
  assert.equal(calls.length, 1);
  assert.equal(a.quotes.corn.close, 480.5);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  await AG.json("/data/prices.json");
  assert.equal(calls.length, 1, "a later reader on the same page reuses the request");
});

test("each reader gets its own object, so one script cannot edit another's copy", async () => {
  const { AG } = page(() => ok('{"quotes":{"corn":{"close":480.5}}}'));
  const a = await AG.json("/data/prices.json");
  a.quotes.corn = null;
  const b = await AG.json("/data/prices.json");
  assert.equal(b.quotes.corn.close, 480.5);
});

test("different files are different requests", async () => {
  const { AG, calls } = page(() => ok("{}"));
  await Promise.all([AG.json("/data/prices.json"), AG.json("/data/daily.json")]);
  assert.equal(calls.length, 2);
});

test("it asks the server to revalidate, never serves a stale HTTP cache copy", async () => {
  const { AG, calls } = page(() => ok("{}"));
  await AG.json("/data/prices.json");
  assert.equal(calls[0].opts.cache, "no-cache");
});

test("a 404 rejects, and the next call tries again", async () => {
  const { AG, calls } = page((u, n) => (n === 1 ? miss() : ok('{"x":1}')));
  await assert.rejects(AG.json("/data/prices.json"));
  const d = await AG.json("/data/prices.json");
  assert.equal(d.x, 1);
  assert.equal(calls.length, 2);
});

test("bad JSON rejects for that reader without poisoning the text", async () => {
  const { AG, calls } = page(() => ok("not json"));
  await assert.rejects(AG.json("/x.json"));
  assert.equal(await AG.text("/x.json"), "not json");
  assert.equal(calls.length, 1);
});

test("AG.text shares the request with AG.json for the same URL", async () => {
  const { AG, calls } = page(() => ok("BEGIN:VCALENDAR"));
  const [t1, t2] = await Promise.all([AG.text("/usda-calendar.ics"), AG.text("/usda-calendar.ics")]);
  assert.equal(t1, "BEGIN:VCALENDAR");
  assert.equal(t2, t1);
  assert.equal(calls.length, 1);
});
