// Sig, 2026-10-19: the About page Person record lists sameAs farmers1st.com and
// lokedrone.com (his only other profiles); url and worksFor stay as they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;

test("about.html Person: sameAs is Sig's two profiles; url and worksFor unchanged", () => {
  const h = readFileSync(ROOT + "about.html", "utf8");
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const people = blocks.flatMap((b) => b["@graph"] || [b]).filter((n) => n["@type"] === "Person");
  assert.equal(people.length, 1, "one Person record");
  const p = people[0];
  assert.deepEqual(p.sameAs, ["https://farmers1st.com", "https://lokedrone.com"]);
  assert.equal(p.url, "https://farmers1st.com");
  assert.deepEqual(p.worksFor, { "@type": "Organization", name: "Farmers First Agri Service", url: "https://farmers1st.com" });
});
