/* Short futures addresses readers type (/corn-futures, /soybean-futures, /wheat-futures, /cattle-futures) open the
   price pages from the 404 page (a ChatGPT benchmark, Oct 29, 2026, found /corn-futures did not open).
   node --test test/futures-slugs.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../404.html", import.meta.url), "utf8");
const js = [...html.matchAll(/<script>(\(function\(\)\{var m=\/\^\\\/\(corn[\s\S]*?)<\/script>/g)].map((m) => m[1]);

test("the 404 page sends each short futures address to its price page, keeping the query and hash", () => {
  assert.equal(js.length, 1, "one futures redirect script");
  for (const [path, want] of [["/corn-futures", "/corn-futures-prices"], ["/soybean-futures/", "/soybean-futures-prices"],
    ["/wheat-futures.html", "/wheat-futures-prices"], ["/cattle-futures", "/cattle-futures-prices"]]) {
    let went = null;
    const ctx = { window: {}, location: { pathname: path, search: "?x=1", hash: "#h", replace: (u) => { went = u; } } };
    vm.runInNewContext(js[0], ctx);
    assert.equal(went, want + "?x=1#h", path);
    assert.ok(existsSync(new URL(".." + want + ".html", import.meta.url)), want + " exists");
  }
  let went = null;
  vm.runInNewContext(js[0], { window: {}, location: { pathname: "/corn-futures-prices-x", search: "", hash: "", replace: (u) => { went = u; } } });
  assert.equal(went, null, "other paths are left alone");
});
