/* Farmland Atlas "Auction results" (Nov 7, 2026): the sold and auction results a land auction firm
 * publishes on its own site, on the county page as their own card after the Land card, never mixed into the
 * recorded sales, surveys or census values. Newest first; each row: date, headline acres, total sold, each
 * tract group with the firm's own per-acre figure when it printed one, and a link to the firm's page. No
 * names. A county with no records gets no card at all.
 *
 *   node --test test/atlas-auctions.test.mjs
 *
 * Fixtures: test/fixtures/atlas-auctions/schrader.json is a copy of data/land/auctions/schrader.json as of
 * Nov 7, 2026 (Wayne IN 18177, auction 9630; Knox IN 18083, auction 9580). made-up.json holds made-up
 * records, one per rule: an older Wayne row (order, and name fields that must never print), a row dated
 * after the build day, a row whose link is not the firm's page, a row from a firm we do not read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FX = "test/fixtures/atlas-auctions/";
const EM = /\u2014/;

function build(files) {
  const out = mkdtempSync(join(os.tmpdir(), "atlas-auc-"));
  try {
    execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "18177", "18083", "18001", "--out", out, "--auctions", ...files.map((f) => FX + f)],
      { cwd: ROOT, env: { ...process.env, PYTHONHASHSEED: "0", AGSIST_BUILD_DATE: "2026-11-07" }, stdio: "pipe" });
    const pg = (p) => readFileSync(join(out, "farmland-atlas/indiana", p + ".html"), "utf8");
    const size = (p) => statSync(join(out, "farmland-atlas/indiana", p + ".html")).size;
    return { wayne: pg("wayne-county"), knox: pg("knox-county"), adams: pg("adams-county"), size: size("wayne-county") };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
const section = (h) => {
  const i = h.indexOf('<section class="card" aria-labelledby="c-auc">');
  return i < 0 ? "" : h.slice(i, h.indexOf("</section>", i) + 10);
};
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const CREDIT = "Sold and auction results reported by Schrader Real Estate and Auction Co. Not recorded transfers; not every sale is listed. Figures as published by the auction firm.";

const P = build(["schrader.json"]);

test("Wayne IN: auction 9630 with its three tract groups, the total and the link", () => {
  const s = section(P.wayne);
  assert.ok(s, "Wayne has an Auction results card");
  assert.match(s, /<h2 id="c-auc">Auction results<\/h2>/);
  assert.match(s, /<b>Nov 5, 2026<\/b>: 296\.5 acres, \$2,905,000 total sold\./);
  const rows = [...s.matchAll(/<li>(Tracts? [^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(rows, [
    "Tracts 1+2+4+5+7: $1,660,000, $9,459/acre, as reported",
    "Tract 3: $245,000, no per-acre figure published",
    "Tracts 6+8: $1,000,000, $9,709/acre, as reported",
  ]);
  assert.match(s, /<a href="https:\/\/www\.schraderauction\.com\/auctions\/9630" rel="noopener">Schrader auction #9630<\/a>/);
  assert.ok(text(s).includes(CREDIT), "credit line under the rows");
});

test("Knox IN gets its own record; Adams IN, with none, gets no card and no placeholder", () => {
  const k = section(P.knox);
  assert.match(k, /<b>Oct 27, 2026<\/b>: 331 acres, \$1,820,000 total sold\./);
  assert.match(k, /Tract 1: \$1,160,000, \$7,030\/acre, as reported/);
  assert.match(k, /Schrader auction #9580/);
  assert.doesNotMatch(k, /9630/);
  assert.equal(section(P.adams), "");
  assert.doesNotMatch(P.adams, /c-auc|Auction results|schraderauction/i);
});

test("its own card, after the Land card and outside it", () => {
  const h = P.wayne;
  const land = h.indexOf('aria-labelledby="c-land"'), landEnd = h.indexOf("</section>", h.lastIndexOf('id="c-land"'));
  const auc = h.indexOf('aria-labelledby="c-auc"'), prog = h.indexOf('aria-labelledby="c-prog"');
  assert.ok(land > 0 && auc > land && prog > auc, "Land, then Auction results, then Programs");
  // the Land card's own sections close before the auction card opens: nothing of it sits inside the Land card
  assert.ok(!h.slice(land, auc).includes("schraderauction"), "no auction figure in the Land card");
  assert.ok(landEnd < auc);
});

test("no names, no new JSON-LD, no em dash, inside the page budget", () => {
  const s = section(P.wayne);
  assert.doesNotMatch(text(s), /buyer|purchaser|owner|seller|sold to/i);
  assert.doesNotMatch(s, EM);
  const ld = [...P.wayne.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(" ");
  assert.doesNotMatch(ld, /"(Offer|Product|AggregateOffer)"|schraderauction/);
  assert.ok(P.size < 150 * 1024, "Wayne page " + P.size + " bytes");
});

test("made-up records: newest first, a later date, another link or another firm never prints, name fields never print", () => {
  const M = build(["schrader.json", "made-up.json"]);
  const s = section(M.wayne);
  assert.ok(s.indexOf("Nov 5, 2026") < s.indexOf("Mar 4, 2025") && s.indexOf("Mar 4, 2025") > 0, "newest first");
  assert.match(s, /Schrader auction #9001/);
  for (const id of ["9002", "9003", "9004"]) assert.ok(!s.includes(id), "auction " + id + " left out");
  for (const t of ["$777,000", "$888,000", "$999,000", "example.com"]) assert.ok(!s.includes(t), t + " left out");
  for (const t of ["[buyer]", "[owner]", "[seller]", "[phone]"]) assert.ok(!M.wayne.includes(t), t + " never printed");
  // one credit line, the same whatever the number of rows
  assert.equal(s.split("Sold and auction results reported by").length - 1, 1);
});

test("the builder reads only the fields it prints: no name field anywhere in its reader", () => {
  const py = readFileSync(join(ROOT, "scripts/build_atlas_pages.py"), "utf8");
  const a = py.indexOf("def auction_record("), b = py.indexOf("def watch_form(");
  const code = py.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.doesNotMatch(code, /\[["'](?:buyer|owner|seller|purchaser|name)["']\]|get\(["'](?:buyer|owner|seller|purchaser|name)["']/);
  assert.doesNotMatch(code, EM);
});

test("tract ranges from the archive pages ('1-3+9') are kept, and read as 'Tracts'", () => {
  const py = `
import sys, json
sys.path.insert(0, "scripts")
import build_atlas_pages as B
r = {"source": "schrader", "auction_id": "ohio-land-auction-180-acres-offered-in-6-tracts-2013", "county_fips": "39129", "date": "2013-08-28",
     "headline_acres": 179.8, "total_sold": 1270000, "kind": "auction",
     "url": "https://www.schraderauction.com/auctions/ohio-land-auction-180-acres-offered-in-6-tracts-2013",
     "tracts": [{"tracts": "1-3+9", "sold": 850000, "per_acre": 7162}, {"tracts": "4", "sold": 120000, "per_acre": None}]}
a = B.auction_record(r, "2026-11-08")
bad = dict(r, tracts=[{"tracts": "1-3; sold to X", "sold": 5, "per_acre": None}])
print(json.dumps({"kept": a is not None, "bad": B.auction_record(bad, "2026-11-08") is None, "html": B.auction_section([a])}))
`;
  const o = JSON.parse(execFileSync("python3", ["-c", py], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").pop());
  assert.ok(o.kept, "a range is a tract label");
  assert.ok(o.bad, "text in a tract label is still refused");
  assert.match(o.html, /<li>Tracts 1-3\+9: \$850,000, \$7,162\/acre, as reported<\/li>/);
  assert.match(o.html, /<li>Tract 4: \$120,000, no per-acre figure published<\/li>/);
});
