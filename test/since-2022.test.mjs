import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("footer shows Since 2022 exactly once", () => {
  assert.equal((read("components/footer.html").match(/Since 2022/g) || []).length, 1);
});

test("about page says AGSIST has been free farm data since 2022", () => {
  assert.ok(read("about.html").includes("<p>AGSIST has been free farm data since 2022.</p>"));
});

test("organization data carries foundingDate 2022 on every page that defines it", () => {
  const files = ["index.html", "cash-bids.html", "corn-futures-prices.html", "soybean-futures-prices.html",
    "wheat-futures-prices.html", "components/seo-template.html"];
  for (const f of files) {
    const t = read(f);
    const i = t.indexOf("#organization\"");
    const m = /"@type":\s*"Organization",\s*"@id":\s*"https:\/\/agsist\.com\/#organization"[\s\S]*?"foundingDate":\s*"2022"/.exec(t);
    assert.ok(i > 0 && m, f + ": Organization has foundingDate 2022");
    assert.equal((t.match(/"foundingDate"/g) || []).length, 1, f);
  }
});
