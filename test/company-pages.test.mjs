// Company pages, /cash-bids/company/<slug> (scripts/build_company_pages.py).
// Built inside scripts/build_cash_bid_pages.py from the same rows as the town
// pages; the cash-bid-pages workflow builds and commits them with the towns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, "utf8");

test("company builder selftest: answer, freshness, links, structured data, noindex when quiet", () => {
  const out = execFileSync("python3", ["scripts/build_company_pages.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /build_company_pages selftest ok/);
});

test("the town builder's selftest (the workflow's gate) runs the company selftest", () => {
  const src = read("scripts/build_cash_bid_pages.py");
  const st = src.slice(src.indexOf("def selftest():"));
  assert.match(st, /CO\.selftest\(\)/);
  assert.match(src, /CO\.write_all\(companies, ctx, tmp\)/, "company pages are written into the tree that is swapped in");
  assert.match(src, /bd\["company_path"\]/, "town pages link the company page");
});

test("the workflow commits the company pages with the towns, on no new schedule", () => {
  const wf = read(".github/workflows/cash-bid-pages.yml");
  assert.match(wf, /python scripts\/build_cash_bid_pages\.py --selftest/);
  assert.match(wf, /git add -A cash-bids /, "cash-bids/company/ is inside cash-bids/");
  const crons = wf.match(/cron:/g) || [];
  assert.equal(crons.length, 1, "one backstop schedule, as before");
});

test("company builder copy: no em dashes, says not affiliated, reads the public board", () => {
  const src = read("scripts/build_company_pages.py");
  assert.ok(!src.includes("—"), "no em dashes");
  assert.match(src, /AGSIST is not affiliated with/);
  assert.match(src, /public bid\s+board/);
  assert.ok(!/official|partner of|in partnership/i.test(src.replace(/^.*"""[\s\S]*?"""/m, "")), "no affiliation claim");
  const cap = Number((src.match(/^MAX_PAGE_KB = (\d+)/m) || [])[1]);
  assert.ok(cap > 0 && cap < 150, "the build refuses a company page near the 150 KB set cap");
});

test("site search lists company pages with no number in the entry", () => {
  const src = read("scripts/build_search_index.py");
  assert.match(src, /def build_companies\(\)/);
  assert.match(src, /"Every location"/);
});
