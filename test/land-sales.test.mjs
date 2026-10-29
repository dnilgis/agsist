/* Farm sales in front of readers (Sig, Oct 27, 2026; STANDING-DECISIONS Oct 27 lines):
 *   - names behind a tap: pages show the sale without names plus "Show buyer and seller"; the names load
 *     on tap from /data/land/names/, a folder robots.txt blocks; a "Remove my name" link beside them;
 *   - no buyer or seller name in any published page, sitemap, snippet or data file outside data/land/
 *     (every name the tap can show is grepped for in every published text file);
 *   - "unusual price" with plain possible reasons, never "questionable" or any accusing word;
 *   - a section with too few sales is withheld and says why; the coverage line counts the live states;
 *   - the pages stay small (the site is near its 1 GB Pages limit).
 * Pages and data: scripts/build_land_sales.py. Blocks on other pages: components/land-sales.js.
 *
 *   node --test test/land-sales.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 300000 });
const DASH = /[–—]|&mdash;|&ndash;/;
const ACCUSE = /questionable|suspicious|suspect\b|fraud|shady|sham\b|bogus|fishy|crooked/i;

function walk(dir, out = []) {
  for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const PAGES = walk("land-sales").filter((p) => p.endsWith(".html"));
const NAME_FILES = walk("data/land/names").filter((p) => p.endsWith(".json"));

// Every name the tap can show, the way test/atlas-sales-names.test.mjs reads them: 6 characters or more,
// not a plain place ("CONDIT TOWNSHIP"), not one plain word ("FARMLAND").
const PLACE_WORDS = new Set(["TOWNSHIP", "TOWN", "COUNTY", "VILLAGE", "CITY", "OF", "THE", "STATE", "ILLINOIS", "WISCONSIN", "INDIANA"]);
// A county government as a party ("Monroe County", "County of Dane") carries the county's own name, which every
// page prints anyway: not a private name (build_land_sales.public_body, the same rule).
const COUNTIES = new Set(["il", "wi", "in"].flatMap((st) => JSON.parse(read(`data/land/${st}/index.json`)).counties.map((c) => String(c.name).toUpperCase())));
function publicBody(v) {
  const m = /^(?:COUNTY OF ([A-Z .']+)|([A-Z .']+) COUNTY)$/.exec(String(v).toUpperCase().replace(/\s+/g, " ").trim().replace(/,? (?:ILLINOIS|WISCONSIN|INDIANA)$/, ""));
  return !!m && COUNTIES.has((m[1] || m[2]).trim());
}
function tapNames() {
  const out = new Set();
  for (const p of NAME_FILES) {
    const o = JSON.parse(read(p));
    const vals = [];
    for (const v of Object.values(o.sales || {})) if (Array.isArray(v)) vals.push(...v);
    for (const v of Object.values(o.buyers || {})) vals.push(v);
    for (const raw of vals) {
      const v = String(raw || "").trim();
      if (v.length < 6) continue;
      const ws = v.toUpperCase().split(/[^A-Z0-9&']+/).filter((w) => w.length >= 3);
      if (ws.length && ws.every((w) => PLACE_WORDS.has(w))) continue;
      if (ws.length < 2 && !/\d/.test(v)) continue;
      if (publicBody(v)) continue;
      out.add(v);
    }
  }
  return out;
}
// A party that is a grain buyer the site already lists by its business name (an elevator or co-op in
// the elevator list) is not a private name: "LANDMARK SERVICES COOPERATIVE" is on the bid pages anyway.
function elevatorNames() {
  const s = new Set();
  for (const f of ["data/ids/elevators.json", "data/elevator-coverage.json", "data/elevator-directory.json", ...basisFiles()]) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const t = read(f);
    for (const m of t.matchAll(/"((?:[^"\\]|\\.){6,90})"/g)) s.add(bizKey(m[1]));
  }
  return s;
}
// the basis history names each grain buyer by its business name, and the ag stocks data each listed
// company by its own (a public company that bought farm ground is not a private name)
function basisFiles() {
  const out = [];
  for (const dir of ["basis-sparklines", "agstocks"]) {
    const d = path.join(ROOT, "data", dir);
    if (fs.existsSync(d)) out.push(...fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => `data/${dir}/` + f));
  }
  return out;
}
// a party whose name starts a listed business's name ("X Grain" and "X Grain Co." in the list) is that business
function isBiz(biz, n) {
  const k = bizKey(n);
  if (biz.has(k)) return true;
  if (k.length < 8) return false;
  for (const b of biz) if (b.startsWith(k)) return true;
  return false;
}
// letters and digits only, so "Rose Acre Farms, Inc" on a return and "Rose Acre Farms, Inc." in the list are one business
function bizKey(v) { return String(v).toUpperCase().replace(/[^A-Z0-9]+/g, ""); }

test("robots.txt blocks the names folder, and nothing reopens it", () => {
  const r = read("robots.txt");
  assert.match(r, /^Disallow: \/data\/land\/$/m, "robots.txt blocks /data/land/");
  // the longest matching rule wins (Google's and RFC 9309's precedence); an Allow as long as the Disallow wins too
  const rules = r.split("\n").map((l) => /^(Allow|Disallow):\s*(\S+)/i.exec(l)).filter(Boolean)
    .map((m) => ({ allow: /^allow$/i.test(m[1]), pat: m[2], re: new RegExp("^" + m[2].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")) }));
  for (const f of NAME_FILES) {
    const hit = rules.filter((x) => x.re.test("/" + f)).sort((a, b) => b.pat.length - a.pat.length || (b.allow ? 1 : 0) - (a.allow ? 1 : 0))[0];
    assert.ok(hit && !hit.allow, `robots.txt lets crawlers fetch ${f} (${hit ? "Allow: " + hit.pat : "no rule"})`);
  }
  assert.ok(!ACCUSE.test(read("scripts/build_land_sales.py").replace(/ACCUSE|questionable" or any word|never "questionable"|questionable\|suspicious\|fraud\|shady\|sham/g, "")), "the builder's own words");
  assert.ok(!/^Disallow: \/land-sales/m.test(r), "the sale pages themselves are open to search");
  assert.match(r, /^Sitemap: https:\/\/agsist\.com\/sitemap-land-sales\.xml$/m, "the land sales sitemap is listed");
  assert.ok(NAME_FILES.length > 100, "names files exist for the county pages and the month: " + NAME_FILES.length);
  for (const f of NAME_FILES) assert.ok(f.startsWith("data/land/names/") && !/summary\.json$/.test(f), f);
});

test("no buyer or seller name in any published page, sitemap or data file outside data/land/", () => {
  const names = tapNames();
  assert.ok(names.size > 1000, "the names the tap can show were read: " + names.size);
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "lsn-"));
  const list = path.join(tmp, "names.txt");
  fs.writeFileSync(list, [...names].join("\n") + "\n");
  // every tracked or new text file a reader or a crawler can fetch, but the blocked folders
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
    "*.html", "*.xml", "*.json", "*.txt", "*.js", "*.mjs", "*.csv", "*.md", "*.ics", "*.webmanifest"], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString().split("\0").filter((f) => f && !f.startsWith("data/land/") && !f.startsWith("test/") && fs.existsSync(path.join(ROOT, f)));
  assert.ok(files.length > 5000, "the whole site was searched: " + files.length + " files");
  for (const must of ["land-sales/index.html", "sitemap-land-sales.xml", "data/land-sales/latest.json", "data/land-sales/il.json", "data/land-sales/wi.json", "index.html", "fast-facts.html"])
    assert.ok(files.includes(must), "searched " + must);
  const hits = [];
  for (let i = 0; i < files.length; i += 2000) {
    // whole words (-w): a party "X Cooper" is not printed by a page that says "X Cooperative" (every sale's names
    // are in the tap files since Oct 29, so partial-word matches with town and company names are common)
    const r = spawnSync("grep", ["-F", "-w", "-o", "-H", "-f", list, "--", ...files.slice(i, i + 2000)], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
    assert.ok(r.status === 0 || r.status === 1, "grep ran: " + r.stderr);
    for (const l of (r.stdout || "").split("\n").filter(Boolean)) { const k = l.indexOf(":"); hits.push([l.slice(0, k), l.slice(k + 1)]); }
  }
  const biz = elevatorNames();
  // a real town that shares a party's name (GeoNames' "Bingham Farms", Michigan; "Brittany Farms-Highlands",
  // Pennsylvania) is a place in our own place list (data/places/, 2026-10-29), not the party: allowed only when the
  // hit is inside one of that file's town names, as whole words
  const town = (f, n) => {
    if (!/^data\/places\/(us|ca)\/[^/]+\.json$/.test(f)) return false;
    const w = new RegExp("(^|[^A-Za-z])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z]|$)");
    try { return (JSON.parse(read(f)).p || []).some((r) => typeof r[0] === "string" && w.test(r[0])); } catch (e) { return false; }
  };
  const bad = hits.filter(([f, n]) => !isBiz(biz, n) && !town(f, n));
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} buyer or seller name(s) outside data/land/`);
  // and the generated sale pages carry no name of any kind, elevator or not
  assert.deepEqual(hits.filter(([f]) => f.startsWith("land-sales/") || f.startsWith("data/land-sales/") || f === "sitemap-land-sales.xml").slice(0, 5), []);
});

test("the builder: selftest, a fresh build matches the committed files, and it refuses a name leak", () => {
  const s = py(["scripts/build_land_sales.py", "--selftest"]);
  for (const name of ["no name outside data/land/", "a quit claim is never listed", "no accusing words", "unusual price wording",
    "sections withheld with a reason when too few", "a removed sale keeps no names"]) assert.ok(s.includes("ok   " + name), name + "\n" + s);
  assert.match(s, /build_land_sales selftest: ok/);
  assert.match(py(["scripts/build_land_sales.py", "--check"]), /match a fresh build/);
  const src = read("scripts/build_land_sales.py");
  assert.match(src, /REFUSED: a buyer or seller name would be written outside data\/land\//, "main() refuses to write a leak");
});

test("the pages: the tap and the remove link, plain words, withheld sections say why, small", () => {
  assert.ok(PAGES.length > 260, "a page per IL, WI and IN county, the hub and the month: " + PAGES.length);
  const month = PAGES.filter((p) => /land-sales\/\d{4}-\d{2}\.html$/.test(p));
  assert.ok(month.length >= 1, "a dated monthly update page");
  for (const p of PAGES) {
    const t = read(p);
    assert.ok(Buffer.byteLength(t) < 150 * 1024, `${p} is ${Buffer.byteLength(t)} bytes; generated pages stay under 150 KB`);
    assert.ok(!DASH.test(t), `${p}: no em or en dash`);
    // place names in the table cells are the state's ("Crooked Creek township"); every other word is ours
    assert.ok(!ACCUSE.test(t.replace(/<td>[^<]*(?:<a [^>]*>[^<]*<\/a>)?<\/td>/g, "")), `${p}: no accusing word`);
    for (const m of t.matchAll(/<button type="button" class="ls-nm" data-ls-id="([^"]+)" data-ls-f="([^"]+)">/g)) {
      assert.match(m[1], /^b?[0-9a-f]{9,10}$/, `${p}: an opaque sale id`);
      assert.match(m[2], /^\/data\/land\/names\/[a-z0-9/-]+\.json$/, `${p}: names load from the blocked folder`);
      assert.ok(fs.existsSync(path.join(ROOT, m[2].slice(1))), `${p}: ${m[2]} exists`);
    }
    assert.match(t, /\/components\/land-sales\.js\?v=\d+/, `${p}: loads the tap`);
    assert.match(t, /<link rel="canonical" href="https:\/\/agsist\.com\/land-sales\//, `${p}: canonical`);
    assert.match(t, /Source: .*(Illinois Department of Revenue|Wisconsin Department of Revenue|Indiana Department of Local Government Finance|Vermont Department of Taxes)/, `${p}: the source is credited where the sales show`);
  }
  const m = read(month.sort().pop());
  for (const h of ["Biggest buyers", "Biggest sales", "Unusual prices", "Best value per acre"]) assert.ok(m.includes(">" + h + "</h2>"), "month section " + h);
  assert.match(m, /possible reasons:<\/b> a house or buildings, timber/, "plain possible reasons above the usual");
  assert.match(m, /family or neighbor sale, a part interest/, "plain possible reasons below the usual");
  assert.match(m, /County usual \$\/acre/, "the county usual is shown");
  assert.match(m, /\d+ sales\)/, "with its count (n)");
  assert.match(m, /over Oct 1, 2024 to Sep 30, 2026|over [A-Z][a-z]{2} \d+, \d{4} to [A-Z][a-z]{2} \d+, \d{4}/, "and its window");
  assert.match(m, /Sales reported for \d+ states: /, "the coverage line");
  assert.match(m, /data-land-alert/, "the monthly email ask on the update page");
  // a withheld section says so (builder selftest covers the case with few sales)
  assert.match(read("scripts/build_land_sales.py"), /Not shown this month: %s\./);
});

test("the coverage table: every state, honest statuses, the live count matches the pages", () => {
  const cov = JSON.parse(read("data/land-sales/coverage.json"));
  assert.equal(cov.states.length, 50, "50 states");
  const live = cov.states.filter((s) => s.status === "live").map((s) => s.st).sort();
  assert.deepEqual(live, ["IL", "IN", "VT", "WI"], "Indiana turned on (Sig, Oct 27), Vermont Oct 29");
  for (const s of cov.states) {
    assert.ok(cov.labels[s.status], `${s.st}: a status with a label`);
    assert.ok(s.tile && s.tile.length === 2, `${s.st}: a map tile`);
    assert.ok(s.source && !DASH.test(JSON.stringify(s)), `${s.st}: a source line, no dashes`);
  }
  for (const st of ["AK", "ID", "KS", "LA", "MS", "MO", "MT", "NM", "ND", "TX", "UT", "WY"])
    assert.equal(cov.states.find((s) => s.st === st).status, "nondisclosure", st + " is listed as not public record");
  for (const st of ["illinois", "wisconsin", "indiana"]) assert.ok(fs.readdirSync(path.join(ROOT, "land-sales", st)).length > 70, "pages for " + st);
  assert.equal(fs.readdirSync(path.join(ROOT, "land-sales", "vermont")).length, 14, "a page for each of Vermont's 14 counties");
  assert.match(read("land-sales/index.html"), /Sales reported for 4 states: Illinois, Indiana, Vermont and Wisconsin\./);
  // Vermont (Oct 29): the method note maps the return onto the shared rule; current use is a fact per sale; the ask shows
  const vtPage = read("land-sales/vermont/addison-county.html");
  assert.match(vtPage, /Vermont sales come from the property transfer tax return\. A return is a farm sale here when the land&#x27;s use before or after the sale is an operating farm or timberland, or open land enrolled in current use\./);
  assert.match(vtPage, /related to the seller[^<]*transfer tax exemption[^<]*without pay, by divorce or by foreclosure[^<]*less than the whole interest/);
  assert.match(vtPage, /<td>Enrolled in current use<\/td>/, "current use enrollment shown on the sale");
  assert.match(vtPage, /data-land-alert/, "the monthly email covers Vermont");
  // Indiana's records differ from IL and WI: the pages say what they carry; the email covers Indiana too (Oct 27), so the ask shows
  const inPage = read("land-sales/indiana/adams-county.html");
  assert.match(inPage, /Indiana&#x27;s sales disclosure forms carry the sale date, not a recording date, and the town is the parcel&#x27;s mailing town/);
  assert.match(inPage, /data-land-alert/, "the monthly email covers Indiana: the ask on an Indiana county page");
  assert.match(read("land-sales/illinois/adams-county.html"), /data-land-alert/);
});

test("data files: no names, only the published fields", () => {
  const L = JSON.parse(read("data/land-sales/latest.json"));
  assert.match(L.month, /^\d{4}-\d{2}$/);
  assert.ok(fs.existsSync(path.join(ROOT, "land-sales", L.month + ".html")), "latest.json points at a built page");
  for (const t of L.top) assert.deepEqual(Object.keys(t).sort(), ["acres", "basis", "county", "id", "place", "ppa", "price", "st", "when"]);
  for (const st of ["il", "wi", "in", "vt"]) {
    const f = JSON.parse(read(`data/land-sales/${st}.json`));
    assert.deepEqual(f.cols, ["id", "when", "recorded", "acres", "price", "ppa", "place", "lat", "lng", "flag", "bldg"]);
    assert.equal(f.names_dir, `/data/land/names/${st}/`);
    for (const [fips, c] of Object.entries(f.counties)) {
      for (const r of c.s) {
        assert.equal(r.length, 11, `${st} ${fips}: a featured row has the eleven published fields`);
        assert.ok(r[6] == null || typeof r[6] === "string", "place");
      }
      const nf = JSON.parse(read(`data/land/names/${st}/${fips}.json`));
      for (const r of c.s) assert.ok(r[0] in nf.sales, `${st} ${fips}: the tap finds sale ${r[0]}`);
    }
    assert.ok(Buffer.byteLength(read(`data/land-sales/${st}.json`)) < 120 * 1024, `${st}.json stays small (loaded on demand)`);
  }
});

test("the component: names load only from the blocked folder; the remove link carries only the sale id", () => {
  const src = read("components/land-sales.js");
  assert.match(src, /\/\^\\\/data\\\/land\\\/names\\\/\/\.test\(f/, "the tap fetches only /data/land/names/ files");
  assert.ok(!DASH.test(src) && !ACCUSE.test(src), "plain words");
  const listeners = [];
  const doc = { readyState: "complete", addEventListener: (t, f) => listeners.push([t, f]), querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: {}, getElementById: () => null };
  const win = { document: doc, location: { pathname: "/", hash: "", search: "" }, fetch: () => Promise.reject(new Error("no")) };
  win.window = win;
  vm.runInNewContext(src, Object.assign(win, { Promise, Math, String, Array, Object, encodeURIComponent, setTimeout }));
  const A = win.AgLandSales;
  const href = A.removeHref("0a1b2c3d4e");
  assert.match(href, /^mailto:sig@agsist\.com\?subject=Remove%20my%20name%2C%20farm%20sale%200a1b2c3d4e&body=/);
  const h = A.namesHtml("0a1b2c3d4e", ["SELLER PERSON", "BUYER PERSON"]);
  assert.match(h, /Seller: SELLER PERSON<br>Buyer: BUYER PERSON/);
  assert.match(h, /Remove my name<\/a>/);
  assert.ok(!/PERSON/.test(h.match(/href="([^"]+)"/)[1]), "no name in the remove link");
  assert.match(A.namesHtml("x", 0), /taken off this site at the owner/);
  assert.equal(Math.round(A.miles(45, -91, 46, -91) * 10) / 10, 69.1, "one degree of latitude is 69.1 miles");
});

test("where the sales show: Atlas county pages, IL and WI rent pages, homepage, Fast Facts, search, Daily", () => {
  const loader = read("components/loader.js");
  assert.match(loader, /\/components\/land-sales\.js\?v=3/);
  assert.match(loader, /section\[data-atlas-sales="county"\]/);
  assert.match(loader, /rent\\\/\(illinois\|wisconsin\|indiana\|vermont\)/);
  assert.match(loader, /farmland-atlas\\\/\(indiana\|vermont\)/, "Indiana's and Vermont's Atlas county pages load it too");
  // the card holds its space from the first paint (no hidden-then-shown jump; CLS) and works with no data
  assert.match(read("index.html"), /<a class="land-cell" id="land-sales" href="\/land-sales\/" data-land-sales="home" data-track="land"><span class="land-k">Farm sales<\/span><span class="land-v">[^<]+<\/span>/);
  assert.match(read("fast-facts.html"), /<div class="ls-near" id="h-land-sales" data-land-sales="near" hidden><\/div>/, "Fast Facts host (an h- hash opens My place)");
  const s = read("components/search.js");
  assert.match(s, /'Land sales near here: '/);
  assert.match(s, /LAND_ST = \{ IL: 'illinois', WI: 'wisconsin', IN: 'indiana', VT: 'vermont' \}/, "only where the sales are");
  const oh = read("scripts/only_here.py");
  assert.match(oh, /import daily_land_line/, "the Daily line rides in Only here");
  const d = py(["scripts/daily_land_line.py", "--selftest"]);
  assert.match(d, /daily_land_line selftest: ok/);
  assert.match(d, /ok   no names/);
});
