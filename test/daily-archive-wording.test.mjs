/* The Oct 10 and Oct 11 briefings said corn fell "nearly 4%" on WASDE day.
 * The settles were $5.0025 to $4.7975: (4.7975 - 5.0025) / 5.0025 = -4.1%,
 * which is more than 4%, so "nearly 4%" was wrong. Every copy (archive JSON,
 * index, archive pages, Daily cards, archive list, feed) says 4.1%. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("no copy of the WASDE-day corn drop says nearly 4%", () => {
  assert.equal(((4.7975 - 5.0025) / 5.0025 * 100).toFixed(1), "-4.1");
  for (const f of ["data/daily-archive/2026-10-10.json", "data/daily-archive/2026-10-11.json", "data/daily-archive/index.json",
    "daily/2026-10-10.html", "daily/2026-10-11.html", "daily.html", "archive.html", "feed.xml"]) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/near(ly |-)4%/.test(s), f + " still says nearly 4%");
  }
  const a = JSON.parse(readFileSync(join(ROOT, "data/daily-archive/2026-10-10.json"), "utf8"));
  assert.equal(a.headline, "Corn drops 4.1% Friday on WASDE; cattle hold the gains");
});
