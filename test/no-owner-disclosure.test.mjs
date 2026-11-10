// Nov 6, 2026
// No shipped page, sponsor component or email script tells a reader the owner also owns
// another business that may compete with a sponsor. His byline and employer stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const PAGES = ["sponsor.html", "sponsor-kit.html", "sponsor-apply.html", "prf-sponsor.html", "prf-sponsor-kit.html",
  "terms.html", "privacy.html", "editorial-standards.html", "about.html", "contact.html", "list-your-elevator.html",
  "hail-map.html", "field-scout.html", "index.html", "daily.html", "prf.html", "lrp.html"];
const CODE = ["components/sponsor-ad.js", "components/prf-sponsor.js", "components/sponsor-apply.js",
  "components/geo-sponsor.js", "scripts/generate_daily.py", "scripts/send_notice.py", "scripts/send_prf_notice.py",
  "scripts/send_land_alert.py", "scripts/send_rain_month.py", "scripts/form_digest.py", "data/rate-card.json"];
const BANNED = [/also owns?\b/i, /may compete/i, /Loke Drone/i, /never takes a sponsor/i, /OWNER_(SPONSOR_)?NOTE/];

for (const f of [...PAGES, ...CODE]) {
  test("no owner disclosure in " + f, () => {
    const s = read(f);
    for (const rx of BANNED) assert.doesNotMatch(s, rx, f + " still says " + rx);
  });
}

test("the byline and employer identity stay", () => {
  assert.match(read("about.html"), /Sigurd Lindquist, CCA, Farmers First Agri Service/);
  assert.match(read("hail-map.html"), /<meta name="author" content="Sigurd Lindquist, Farmers First Agri Service">/);
  assert.match(read("terms.html"), /Sponsored placements are labeled\. Sponsors never change data, rankings or bid order\./);
});

test("the rate card has no insurance line and sponsor-apply has no hidden insurance note", () => {
  assert.equal("insurance" in JSON.parse(read("data/rate-card.json")), false);
  assert.doesNotMatch(read("sponsor-apply.html"), /spa-insurance/);
  assert.doesNotMatch(read("components/sponsor-apply.js"), /spa-insurance/);
});
