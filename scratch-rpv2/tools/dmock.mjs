// D: the family code box on a scratch copy of the real Rain Print page (served locally, NOAA answers from the saved example; nothing wired)
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
const ROOT = "/tmp/claude-0/-home-user-agsist/e2b06309-5299-5558-aa96-466b373aa229/scratchpad/wt/rpv2/", OUT = process.argv[2];
const { answerOf } = await import(ROOT + "scripts/rain_print_examples_pack.mjs");
const { chromium } = await import("/home/user/node_modules/playwright/index.mjs");
const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const srv = createServer((req, res) => {
  const u = new URL(req.url, "http://x"); let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
  if (!extname(p) && existsSync(p + ".html")) p += ".html";
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const base = "http://127.0.0.1:" + srv.address().port;
const ex = JSON.parse(readFileSync(ROOT + "data/rain-print-examples/2012-ames-ia.json", "utf8"));
const answers = new Map(ex.requests.map((q) => [q.url, answerOf(q)]));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [tag, vw] of [["desktop", 1280], ["phone", 390]]) {
  const context = await browser.newContext({ viewport: { width: vw, height: 1000 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const url = r.request().url(), host = new URL(url).host;
    if (host === "data.rcc-acis.org" || host === "geocoding-api.open-meteo.com") return r.fulfill({ json: answers.get(url) || { error: "not saved" }, headers: { "Access-Control-Allow-Origin": "*" } });
    return r.abort();
  });
  const page = await context.newPage();
  await page.goto(base + "/rain-print.html?place=Ames%2C+IA&year=2012&cmp=normal&normals=1&records=1&style=r1&name=The+Lindquist+Home+Farms");
  await page.waitForFunction(() => document.querySelector("#rp-art svg"), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const css = document.createElement("style");
    css.textContent = `.rp-fam{border:1px solid #D6D9D2;border-radius:10px;padding:14px 16px;margin:0 0 18px;background:#FBFAF6}
      .rp-fam summary{cursor:pointer;font-weight:600}
      .rp-fam-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:10px}
      .rp-fam-row .field{flex:1 1 200px}.rp-fam-row input{letter-spacing:.06em;text-transform:uppercase;font-weight:600}
      .rp-fam-ok{margin:12px 0 0;padding:10px 12px;border-left:3px solid #3C7A4B;background:#F1F6F1;font-size:.95rem;line-height:1.45}
      .rp-fam-ok b{font-weight:600}.rp-fam-note{font-size:.85rem;color:#5E6475;margin:8px 0 0}
      .rp-prefill{box-shadow:0 0 0 2px #3C7A4B33}`;
    document.head.appendChild(css);
    const sec = document.getElementById("rp-design"), h = document.getElementById("rp-design-h");
    const box = document.createElement("details");
    box.className = "rp-fam"; box.open = true;
    box.innerHTML = `<summary>Have a family code?</summary>
      <div class="rp-fam-row"><label class="field"><span>Family code (on the letter in their box)</span><input id="rp-fam-code" type="text" value="LINDQUIST-12" maxlength="16" autocomplete="off"></label>
      <button class="btn btn-secondary" type="button">Use code</button></div>
      <p class="rp-fam-ok" role="status"><b>Code found: The Lindquist Home Farms.</b> Your print starts with the same name and the same look (Staircase). Pick your own town and year in step 1, and write your own line and days below. $10 off is taken at checkout.</p>
      <p class="rp-fam-note">The code fills in the name and style only. It never shows anyone else&rsquo;s print, line or days.</p>`;
    h.insertAdjacentElement("afterend", box);
    const mo = document.getElementById("rp-more"); if (mo) mo.open = false;
    const n = document.getElementById("rp-name"); n.value = "The Lindquist Home Farms"; n.classList.add("rp-prefill");
    const nn = document.getElementById("rp-name-n"); if (nn) nn.textContent = "24 of 24 letters";
  });
  await page.waitForTimeout(300);
  await page.addStyleTag({ content: "header,.site-header,.nav,#rp-phonebar,.rp-phonebar{display:none!important}" });
  await page.evaluate(() => { for (const e of document.querySelectorAll("body *")) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") e.style.setProperty("display", "none", "important"); } });
  const el = await page.$("#rp-design");
  await el.screenshot({ path: OUT + "/D-family-code-entry-" + tag + ".png" });
  await context.close();
}
await browser.close(); srv.close();
