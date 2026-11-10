// Search fixes, Nov 10 2026: titles within the cap, structured data that matches the page,
// and answer lines built from the site's own data.
//   node --test test/seo-nov10.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const py = (code) => execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); " + code],
  { cwd: ROOT, encoding: "utf8" });
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    const N = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘",
      ldquo: "“", rdquo: "”", ndash: "–", times: "×", middot: "·", hellip: "…",
      deg: "°", minus: "−" };
    return N[e] ?? m;
  }).replace(/\s+/g, " ");
const faqOf = (page) => {
  const out = [];
  for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const stack = [JSON.parse(m[1])];
    while (stack.length) {
      const x = stack.pop();
      if (Array.isArray(x)) stack.push(...x);
      else if (x && typeof x === "object") {
        if (x["@type"] === "FAQPage") out.push(...x.mainEntity);
        stack.push(...Object.values(x));
      }
    }
  }
  return out;
};

test("the SEO guard fails a title over 68 characters (selftest)", () => {
  const out = execFileSync("python3", ["scripts/check_seo.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest ok/);
  const src = read("scripts/check_seo.py");
  assert.match(src, /err\(rel, f"title is \{len\(p\['titles'\]\[0\]\)\} chars/, "a long title is an error, not a warning");
});

test("hand page titles are within the cap", () => {
  for (const f of ["ag-stocks.html", "cattle-auction-prices.html", "combine-loss.html", "commodity-loan.html",
    "custom-rates.html", "fall-nitrogen.html", "fast-facts.html", "glossary.html", "harvest-or-wait.html",
    "manure-value.html", "nutrient-removal.html", "rain-print-business.html", "rain-radar.html"]) {
    const t = read(f).match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, "&");
    assert.ok(t.length <= 68, `${f}: ${t.length} ${t}`);
  }
});

test("company titles: count and crops, never a price; meta without a price", () => {
  const t = JSON.parse(py("import build_company_pages as C; print(json.dumps([C.company_title('ADM', 89, ['corn', 'soybeans', 'wheat']), "
    + "C.company_title('A Very Long Cooperative Name Grain Company', 12, ['corn']), C.company_title('X', 3, ['wheat']), "
    + "C.company_desc('ADM', 89, 'Illinois and Iowa', 'Nov 9')]))"));
  assert.equal(t[0], "ADM Grain Bids Today: 89 Locations, Corn and Soybeans");
  assert.ok(t[1].length <= 68 && !/Soybeans/.test(t[1]), t[1]);
  assert.equal(t[2], "X Grain Bids Today: 3 Locations, Wheat");
  assert.ok(!/\$/.test(t[3]) && t[3].length <= 160, t[3]);
});

test("Daily titles fit the cap and keep the date; the Nov 1 issue no longer shares the Oct 31 H1", () => {
  const h1 = (d) => read(`daily/${d}.html`).match(/<h1 class="dv3-headline">([^<]*)<\/h1>/)[1];
  assert.notEqual(h1("2026-10-31"), h1("2026-11-01"));
  for (const d of ["2026-10-21", "2026-11-03", "2026-11-09"]) {
    const t = read(`daily/${d}.html`).match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, "&");
    assert.ok(t.length <= 68 && /\| \w{3} \d{1,2}, 2026/.test(t), t);
  }
});

test("prf.html: every FAQ question and answer in the JSON-LD is on the page", () => {
  const page = read("prf.html"), vis = strip(page);
  const qs = faqOf(page);
  assert.ok(qs.length >= 5);
  for (const q of qs) {
    assert.ok(vis.includes(q.name), q.name);
    assert.ok(vis.includes(q.acceptedAnswer.text), q.name + " answer");
  }
});

test("speakable selectors point at elements with static text", () => {
  const page = read("index.html");
  const m = page.match(/"cssSelector":\s*\[([^\]]*)\]/);
  if (!m) return;
  const sels = JSON.parse(`[${m[1]}]`);
  for (const s of sels) {
    const attr = s.startsWith("#") ? `id="${s.slice(1)}"` : `class="${s.slice(1)}`;
    const i = page.indexOf(attr);
    assert.ok(i > 0, `${s} is on the page`);
    const tag = page.lastIndexOf("<", i), name = page.slice(tag + 1).match(/^\w+/)[0];
    const inner = page.slice(page.indexOf(">", i) + 1, page.indexOf(`</${name}>`, i));
    assert.ok(strip(inner).trim().replace(/^-$/, "").length > 0, `${s} has static text`);
  }
});

test("milk: the last full year's all-milk line is the 12-month average of the data, or withheld", () => {
  const dmc = JSON.parse(read("data/dairy-dmc.json"));
  const page = read("milk-prices.html");
  const seeded = page.match(/<!--SEED:milkyear-->([\s\S]*?)<!--\/SEED-->/);
  assert.ok(seeded, "marker pair on the page");
  const y = Number((seeded[1].match(/<strong>(\d{4}) all-milk price/) || [])[1]);
  if (!y) return;                     // withheld: a month missing from the data
  const vals = Array.from({ length: 12 }, (_, i) => (dmc.margins[`${y}-${String(i + 1).padStart(2, "0")}`] || {}).all_milk);
  assert.ok(vals.every((v) => v > 0), "all 12 months in the data");
  const tenths = vals.reduce((a, v) => a + Math.round(v * 100), 0);   // cents, exact
  const avg = (Math.round(tenths / 12) / 100).toFixed(2);
  assert.ok(seeded[1].includes(`$${avg} per hundredweight`), `average $${avg}`);
  const out = py(`import seed_static as S; print(S.milk_year_seed(json.load(open('data/dairy-dmc.json')), '${y + 1}-06-01'))`).trim();
  assert.equal(out, seeded[1], "the page carries exactly what the seed writes");
});
