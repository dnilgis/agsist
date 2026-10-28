/* County rain pages lead with the Rain Print (Sig, Oct 28 2026, on rain/wisconsin/barron-county.html: "move our
 * Rain Print chart up in place of that generic chart and get rid of that chart or make it hidden").
 *
 *   - On every county page that carries the print, #rc-print is the first chart in <main>, right under the
 *     figures, and the sell block follows it at once.
 *   - The plain running-total chart is no longer a chart of its own there: it ships inside the print's art box
 *     (title and caption kept) as the fallback for readers without scripts, search engines and a print that
 *     cannot be drawn. Drawing the print replaces it.
 *   - It opens in the Roots style (Sig, Oct 28); Staircase and Up close stay as choices.
 *   - Drawing moves nothing: the print's box, picker row and caption are held from the first paint
 *     (rain-county.css), at 390 and 1280. A print that cannot be drawn keeps the chart and lets the room go.
 *
 *   node --test test/rain-print-top.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const pages = [];
for (const st of readdirSync(ROOT + "rain", { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const f of readdirSync(ROOT + "rain/" + st.name).filter((f) => f.endsWith(".html"))) pages.push(`rain/${st.name}/${f}`);
}

test("county pages: the Rain Print is the first chart, the plain chart lives inside it as the fallback", () => {
  assert.ok(pages.length > 1000, `county pages found (${pages.length})`);
  let withPrint = 0;
  for (const p of pages) {
    const h = read(p);
    if (h.includes('name="agsist-pointer"')) continue;   // a moved county: a pointer to the state page, no chart
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    if (!main.includes('id="rc-print"')) {
      // no print for this county: the plain chart stays, on its own, as before
      assert.ok(main.includes('<figure class="rc-chart"><svg'), `${p}: a county without a print keeps the plain chart`);
      continue;
    }
    withPrint++;
    const fig = main.indexOf('<figure class="rc-chart rc-print rc-print-top" id="rc-print"');
    assert.ok(fig > 0, `${p}: the print figure is the top one`);
    const firstChart = Math.min(...["<figure", "<svg", "<canvas", "<img"].map((t) => main.indexOf(t)).filter((i) => i >= 0));
    assert.equal(firstChart, fig, `${p}: no chart or picture comes before the Rain Print`);
    assert.ok(fig < main.indexOf("<h2>Month by month</h2>") && main.indexOf('class="rc-figs"') < fig, `${p}: the print sits between the figures and the month table`);
    const body = main.slice(fig, main.indexOf("</figure>", fig));
    assert.ok(!/ hidden[ >]/.test(body.split(">")[0]), `${p}: the figure is not a hidden shell any more`);
    assert.equal((main.match(/aria-labelledby="rc-ct"/g) || []).length, 1, `${p}: one plain chart in the page`);
    const art = body.slice(body.indexOf('<div class="rc-print-art">'));
    assert.ok(art.startsWith('<div class="rc-print-art"><svg viewBox=') && art.includes('<title id="rc-ct">Running total of rain in '),
      `${p}: the plain chart, with its title, is inside the print's art box`);
    assert.ok(body.includes('<span class="rc-cap-chart">Inches of rain added up day by day') && body.includes('<span class="rc-cap-print" hidden>'),
      `${p}: both captions ship; the print's waits hidden`);
    assert.ok(body.includes('<button type="button" data-style="r2" aria-pressed="true">Roots</button>')
      && body.includes('<button type="button" data-style="r1" aria-pressed="false">Staircase</button>') && body.includes('class="rc-zoom"'),
      `${p}: Roots opens first (Sig, Oct 28); Staircase and Up close stay as choices`);
    assert.ok(body.includes('class="rc-watch"'), `${p}: the picker row ships whole, Watch it draw included, so it is held at full height`);
    assert.ok(main.slice(main.indexOf("</figure>", fig) + 9).trimStart().startsWith('<div class="rc-sell">'), `${p}: the sell block follows the print`);
    assert.equal((main.match(/class="rc-sell"/g) || []).length, 1, `${p}: one sell block`);
  }
  assert.ok(withPrint > 1000, `pages with the print (${withPrint})`);
});

test("the stylesheet holds the print's room only while scripts run, over styles.css's [hidden]", () => {
  const css = read("components/rain-county.css");
  const m = /@media \(scripting: enabled\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, "a scripting-only block");
  assert.match(m[1], /\.rc-print-top:not\(\.rc-print-off\) \.rc-print-styles\[hidden\] \{ display: flex !important; visibility: hidden; \}/);
  assert.match(m[1], /\.rc-print-top:not\(\.rc-print-on\):not\(\.rc-print-off\) \.rc-print-art \{ aspect-ratio: 3 \/ 2;/);
  assert.match(m[1], /\.rc-print-top:not\(\.rc-print-off\) figcaption > span\[hidden\] \{ display: block !important; visibility: hidden; \}/);
  assert.match(read("components/styles.css"), /\[hidden\]\{display:none!important\}/, "the rule the !important answers is still there");
});

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const BOX = () => {
  const q = (s) => document.querySelector(s);
  const r = (s) => { const b = q(s).getBoundingClientRect(); return [Math.round((b.top + scrollY) * 2) / 2, Math.round(b.height * 2) / 2]; };
  return { fig: r("#rc-print"), art: r("#rc-print .rc-print-art"), sell: r(".rc-sell"), month: r("#main h2:nth-of-type(1)") };
};

async function open(browser, port, path, w, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: w < 700 ? 844 : 800 }, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  if (opts.noDays) await pg.route(/\/data\/rain\/daily\//, (r) => r.abort());
  // hold the print's script back so the page can be measured as first painted, before the print draws
  let release;
  const held = new Promise((ok) => { release = ok; });
  await pg.route(/\/components\/rain-county-print\.js/, async (r) => { await held; await r.continue(); });
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "commit" });
  await pg.waitForSelector(".rc-sell");
  await pg.waitForFunction(() => document.fonts.status === "loaded");
  const before = await pg.evaluate(BOX);
  release();
  return { ctx, pg, before };
}

test("browser: the print draws in the chart's place at 390 and 1280 without moving anything; the fallback goes", { skip, timeout: 240000 }, async () => {
  const dry = pages.filter((p) => p.startsWith("rain/arizona/") && read(p).includes('id="rc-print"')).sort()[0];
  const paths = ["/rain/wisconsin/barron-county", "/" + dry.replace(/\.html$/, "")];
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const path of paths) {
      for (const w of [390, 1280]) {
        const { ctx, pg, before } = await open(browser, port, path, w);
        await pg.waitForSelector("#rc-print.rc-print-on", { timeout: 30000 });
        await pg.waitForTimeout(300);
        const after = await pg.evaluate(BOX);
        const at = `${path} at ${w}`;
        for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], `${at}: ${k} [top, height] moved when the print drew`);
        const s = await pg.evaluate(() => ({
          fallback: !!document.querySelector('[aria-labelledby="rc-ct"]'),
          capChart: document.querySelector(".rc-cap-chart").hidden, capPrint: document.querySelector(".rc-cap-print").hidden,
          first: document.querySelector("#main svg").closest("figure").id,
          picker: getComputedStyle(document.querySelector(".rc-print-styles")).visibility,
          roots: document.querySelector('.rc-print-styles [data-style="r2"]').getAttribute("aria-pressed"),
          stair: document.querySelector('.rc-print-styles [data-style="r1"]').getAttribute("aria-pressed"),
        }));
        assert.equal(s.fallback, false, `${at}: the plain chart is gone once the print draws`);
        assert.equal(s.capChart, true, `${at}: the plain chart's caption is hidden`);
        assert.equal(s.capPrint, false, `${at}: the print's caption shows`);
        assert.equal(s.first, "rc-print", `${at}: the first drawing in the page is the Rain Print`);
        assert.equal(s.picker, "visible", `${at}: the style picker shows`);
        assert.deepEqual([s.roots, s.stair], ["true", "false"], `${at}: the print draws in Roots first`);
        await ctx.close();
      }
    }
    // the print cannot be drawn (no days file): the plain chart stays, shown, and the held room is let go
    const { ctx, pg } = await open(browser, port, paths[0], 1280, { noDays: true });
    await pg.waitForSelector("#rc-print.rc-print-off", { timeout: 30000 });
    const f = await pg.evaluate(() => {
      const svg = document.querySelector('#rc-print [aria-labelledby="rc-ct"]');
      const art = document.querySelector("#rc-print .rc-print-art").getBoundingClientRect().height;
      return { shown: !!svg && svg.getBoundingClientRect().height > 100, art, svg: svg && svg.getBoundingClientRect().height,
        cap: getComputedStyle(document.querySelector(".rc-cap-chart")).visibility, picker: getComputedStyle(document.querySelector(".rc-print-styles")).display };
    });
    assert.ok(f.shown, "the plain chart stays when the print cannot be drawn");
    assert.ok(f.art - f.svg < 4, `the art box shrinks to the chart (${f.art} vs ${f.svg})`);
    assert.equal(f.cap, "visible", "its caption shows");
    assert.equal(f.picker, "none", "no empty picker row is left");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
