// Same-state row, bids near a county, visible breadcrumb trails and the /cash-bids opening line (Nov 10, 2026).
// One helper writes each (scripts/cross_links.py); these tests hold the rules, not the live bid data:
// every link target is a live page, the visible trail names the same steps as the BreadcrumbList JSON-LD,
// and each piece stays small. The generated pages are built on main, so the page scans check every page
// that carries a piece (all of a family or none) and the helper is also checked against the checkout itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = (code) => execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); " + code],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });

// "/rent/iowa" -> rent/iowa.html, "/cash-bids/iowa/" -> cash-bids/iowa/index.html
const fileOf = (href) => {
  const p = href.split("#")[0].split("?")[0].replace(/^\//, "");
  if (p === "") return "index.html";
  return p.endsWith("/") ? p + "index.html" : p + ".html";
};
const htmlIn = (dir) => {
  const d = join(ROOT, dir);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".html")).map((f) => join(dir, f)) : [];
};
const subdirs = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

test("cross_links selftest (fixtures: row, bids near, trail, stamp)", () => {
  const out = execFileSync("python3", ["scripts/cross_links.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /cross_links selftest ok/);
});

test("the same-state row, run on this checkout: every target is a live page, the row stays small", () => {
  const got = JSON.parse(py(`
import cross_links as XL, os
slugs = sorted({os.path.splitext(f)[0] for d in ("rent", "yield", "rain", "prf", "hail-map") if os.path.isdir(d)
                for f in os.listdir(d) if f.endswith(".html") and f != "index.html"})
out = {}
for s in slugs:
    for sid, *_ in XL.STATE_SETS:
        out[s + "|" + sid] = [XL.same_state_links(".", s, sid), len(XL.same_state_row(".", s, s.title(), sid).encode())]
print(json.dumps(out))`));
  let links = 0;
  for (const [k, [ls, bytes]] of Object.entries(got)) {
    const here = k.split("|")[1];
    for (const [, href] of ls) {
      assert.ok(existsSync(join(ROOT, fileOf(href))), `${k}: ${href} has no page`);
      assert.ok(!href.startsWith(`/${here}/`), `${k}: the row links its own set`);
      links++;
    }
    assert.ok(bytes <= 720, `${k}: the row is ${bytes} bytes`);
  }
  assert.ok(links >= 1500, `only ${links} same-state links; the state sets have moved`);
});

test("bids near a county, run on this checkout: town pages that exist, three at most, a small line", () => {
  const got = JSON.parse(py(`
import cross_links as XL
rows = [(f, s) for f, s in (("19169", "IA"), ("31109", "NE"), ("38017", "ND"), ("20173", "KS"), ("17113", "IL"), ("46113", "SD"))]
print(json.dumps([XL.near_bids(".", f, s, "prf-fine") for f, s in rows]))`));
  let towns = 0;
  for (const line of got) {
    assert.match(line, /^<p data-xl="near" data-f="\d{5}" data-s="[A-Z]{2}" class="prf-fine"/);
    const hrefs = [...line.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length <= 3, line);
    for (const h of hrefs) {
      assert.match(h, /^\/cash-bids\/[a-z-]+\/[a-z0-9-]+$/, line);
      assert.ok(existsSync(join(ROOT, fileOf(h))), `${h} has no page`);
    }
    towns += hrefs.length;
    assert.ok(Buffer.byteLength(line) <= 420, `${Buffer.byteLength(line)} bytes: ${line}`);
  }
  assert.ok(towns >= 6, `only ${towns} town links for six farm counties; the town points have moved`);
});

// every built page that carries a row or a bids-near line: its links resolve
test("built pages: every same-state and bids-near link resolves", () => {
  const files = [];
  for (const d of ["rent", "yield", "rain", "prf", "hail-map"]) files.push(...htmlIn(d));
  for (const d of ["cash-bids", "farmland-atlas", "land-sales", "prf", "arc-plc"]) {
    for (const s of subdirs(d)) files.push(...htmlIn(join(d, s)));
  }
  assert.ok(files.length >= 5000, `only ${files.length} pages scanned; the sets have moved`);
  let checked = 0;
  for (const f of files) {
    const t = readFileSync(join(ROOT, f), "utf8");
    const parts = [...t.matchAll(/<nav class="xl-st"[^>]*>.*?<\/nav>|<p data-xl="near"[^>]*>.*?<\/p>/gs)].map((m) => m[0]);
    for (const p of parts) {
      for (const m of p.matchAll(/href="([^"]+)"/g)) {
        assert.ok(existsSync(join(ROOT, fileOf(m[1]))), `${f}: ${m[1]} has no page`);
        checked++;
      }
    }
  }
  console.log(`# ${checked} same-state and bids-near links checked`);
});

test("built pages: the visible trail names the same steps as the BreadcrumbList (all of a family or none)", () => {
  const fams = {
    town: subdirs("cash-bids").filter((s) => s !== "company").flatMap((s) => htmlIn(join("cash-bids", s)).filter((f) => !f.endsWith("index.html"))),
    state: subdirs("cash-bids").filter((s) => s !== "company").map((s) => join("cash-bids", s, "index.html")).filter((f) => existsSync(join(ROOT, f))),
    company: htmlIn(join("cash-bids", "company")),
    rent: htmlIn("rent").filter((f) => !f.endsWith("index.html")),
    yield: htmlIn("yield").filter((f) => !f.endsWith("index.html")),
  };
  // a retired page is a pointer (agsist-pointer meta, scripts/pointer_pages.py): it is not built by the set's
  // builder and carries no trail, so it is not one of the family's pages
  for (const k of Object.keys(fams)) fams[k] = fams[k].filter((f) => !readFileSync(join(ROOT, f), "utf8").includes('<meta name="agsist-pointer"'));
  const all = Object.values(fams).flat();
  assert.ok(all.length >= 1000, `only ${all.length} pages; the sets have moved`);
  const res = JSON.parse(execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, 'scripts')
import cross_links as XL
out = {}
for f in json.load(sys.stdin):
    t = open(f, encoding="utf-8").read()
    out[f] = [XL.TRAIL_STYLE in t, XL.trail_matches(t)]
print(json.dumps(out))`], { cwd: ROOT, encoding: "utf8", input: JSON.stringify(all), maxBuffer: 1 << 26 }));
  for (const [fam, fs] of Object.entries(fams)) {
    const built = fs.filter((f) => res[f][0]);
    // built on main: until the rebuild no page has the trail; after it, every page does
    assert.ok(built.length === 0 || built.length === fs.length, `${fam}: ${built.length} of ${fs.length} pages have the new trail`);
    for (const f of built) assert.equal(res[f][1], null, `${f}: ${res[f][1]}`);
    console.log(`# ${fam}: ${built.length} of ${fs.length} pages carry the shared trail`);
  }
});

test("/cash-bids: the visible opening line says the share text's counts and time", () => {
  const t = readFileSync(join(ROOT, "cash-bids.html"), "utf8");
  const open = t.match(/<!--CB-OPEN-->(.*?)<!--\/CB-OPEN-->/s);
  assert.ok(open, "the opening-line markers are on /cash-bids");
  const og = t.match(/<meta property="og:description" content="([^"]*)">/)[1];
  const m = og.match(/current bids from ([\d,]+) elevators? across ([\d,]+) towns?, by ZIP, free\. Updated (.+?) CT\./);
  if (!m) {
    assert.equal(open[1], "", "nothing priced: no count in the opening line");
    return;
  }
  assert.ok(open[1].includes(`from ${m[1]} elevator`) && open[1].includes(`in ${m[2]} town`) && open[1].includes(`updated ${m[3]} CT.`),
    `opening line "${open[1]}" vs share text "${og}"`);
  assert.ok(t.indexOf("<!--CB-OPEN-->") < t.indexOf('id="cb-zip"') && t.indexOf("<h1>") < t.indexOf("<!--CB-OPEN-->"),
    "the line sits right under the heading, above the ZIP box");
});
