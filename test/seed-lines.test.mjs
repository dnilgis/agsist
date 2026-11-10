/* Seeds on their own lines (build rule 67, fx/smallfix1104, Nov 4 2026).
 *
 * The price job reseeds index.html and markets.html every 15 minutes, so a PR whose structural edit
 * shared or neighboured a seed line conflicted with main (#320). scripts/seed_static.py seed_between
 * now writes each seed on a line of its own, split off by an empty comment that holds the line break:
 *   <span id="x"><!--
 *   --><!--SEED:x-->value<!--/SEED--><!--
 *   --></span>
 * The comments add no text node, so nothing renders or moves differently.
 *
 * "the seeder puts every seed on its own line" always runs: it lays both pages out the new way in
 * memory (seed_static.seed_relayout, values unchanged) and checks the lines and the text; the browser
 * test then compares the text and every element's box at 390 and 1280 with scripts off. "no seed marker line carries
 * anything but the value" checks the committed pages and skips while any old-layout seed is still on
 * them: the PR changes only the seeder, and the next price run writes the new layout on main.
 *   node --test test/seed-lines.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const PAGES = ["index.html", "markets.html"];
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const BREAK = "<!--\n-->";

/* [message] for each seed whose line carries anything but the value */
function badLines(html) {
  const bad = [];
  const re = /<!--SEED:([^>]*?)-->/g;
  let m;
  while ((m = re.exec(html))) {
    const close = html.indexOf("<!--/SEED-->", m.index);
    if (close < 0) continue;
    const before = html.slice(html.lastIndexOf("\n", m.index) + 1, m.index);
    const endl = html.indexOf("\n", close);
    const after = html.slice(close + "<!--/SEED-->".length, endl < 0 ? html.length : endl);
    if (before !== "-->" || after !== "<!--") bad.push(`SEED:${m[1]}: line starts "${before.slice(-40)}", ends "${after.slice(0, 40)}"`);
  }
  return bad;
}
const oldSeeds = (html) => (html.match(/<!--SEED:[^>]*?-->/g) || []).length - (html.split(BREAK + "<!--SEED:").length - 1);
const relayout = (f) => execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import seed_static as S; sys.stdout.write(S.seed_relayout(open(sys.argv[1], encoding='utf-8').read()))", f], { cwd: ROOT, encoding: "utf8" });
const noComments = (h) => h.replace(/<!--[\s\S]*?-->/g, "");

const pairs = PAGES.map((f) => [f, read(f), relayout(f)]);
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the seeder puts every seed on its own line, values and text unchanged", () => {
  for (const [f, before, after] of pairs) {
    assert.ok((after.match(/<!--SEED:/g) || []).length >= 8, `${f} carries its seeds`);
    assert.deepEqual(badLines(after), [], f);
    assert.equal(noComments(after), noComments(before), `${f}: only comments differ`);
    // the seeder on an already split page changes nothing
    const again = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import seed_static as S; sys.stdout.write(S.seed_relayout(sys.stdin.read()))"], { cwd: ROOT, encoding: "utf8", input: after });
    assert.equal(again, after, `${f}: reseeding a split page changes nothing`);
  }
});

test("the seeder's layout renders the same text with nothing moved, at 390 and 1280", { skip, timeout: 120000 }, async () => {
  // both layouts of each page, scripts off, every outside host aborted, service workers blocked (build rule 58)
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const pr = pairs.find(([f]) => p === "/__before/" + f || p === "/__after/" + f);
    // the ticker strip scrolls by CSS animation: stopped on both sides so each is measured at rest
    const still = (h) => h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
    if (pr) { res.writeHead(200, { "content-type": "text/html" }); res.end(still(p.startsWith("/__before/") ? pr[1] : pr[2])); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port, browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", javaScriptEnabled: false, reducedMotion: "reduce", viewport: { width: w, height: 900 } });
      await ctx.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}/`), (r) => r.abort());
      const pg = await ctx.newPage();
      for (const [f] of pairs) {
        const shot = async (side) => {
          await pg.goto(`http://127.0.0.1:${port}/__${side}/${f}`, { waitUntil: "load" });
          return pg.evaluate(() => ({
            text: document.body.innerText,
            boxes: [...document.querySelectorAll("body *")].map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, e.id, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(" "); }),
          }));
        };
        const b = await shot("before"), a = await shot("after");
        assert.equal(a.text, b.text, `${f} at ${w}: the same text`);
        assert.deepEqual(a.boxes, b.boxes, `${f} at ${w}: every element in the same place (no shift)`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

const OLD = PAGES.filter((f) => oldSeeds(read(f)) > 0);
test("no seed marker line carries anything but the value",
  { skip: OLD.length ? "old seed layout still on index.html or markets.html; the next price run rewrites it (BUILD-RULES 67)" : false }, () => {
  for (const f of PAGES) assert.deepEqual(badLines(read(f)), [], `${f}: a seed shares its line (BUILD-RULES 67: structural edits go on their own lines)`);
});
