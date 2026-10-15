// 2026-10-15 head to head: the pages that send readers to Rain Print link the bare /rain-print in the words people
// search for (rainfall art, any town and year), one promo a page, no sponsor, no store names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, "utf8");

test("hub and hail map link /rain-print as rainfall art of any town and year", () => {
  for (const f of ["rain.html", "hail-map.html"]) {
    assert.match(read(f), /<a href="\/rain-print">Rain Print, rainfall art of any town and year<\/a>/, f);
  }
});

test("every county rain page carries one plain link to the bare /rain-print inside its one promo block", () => {
  let n = 0;
  for (const st of readdirSync(ROOT + "rain", { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(ROOT + "rain/" + st.name).filter((x) => x.endsWith(".html"))) {
      const h = read(`rain/${st.name}/${f}`);
      const sell = h.split('class="rc-sell"')[1].split("</div>")[0];
      assert.match(sell, /<a href="\/rain-print">Rainfall art of any town and year<\/a>/, f);
      assert.equal(h.split('href="/rain-print"').length - 1, 1, f);
      assert.equal(h.split('href="/rain-print?').length - 1, 1, "still one drawn-place button: " + f);
      n++;
    }
  }
  assert.ok(n > 2000, "county pages checked: " + n);
});
