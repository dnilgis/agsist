/* The gap between a Rain Print's farm name (or town) and its year, measured in the ink (Sig, 2026-10-22: "make
 * sure that the printed year has a space between it and a custom farm name entry"). For
 * test/rain-print-name-space.test.mjs.
 *
 * In the page, before a picture is made, the words before the year are painted pure blue and the year pure red
 * (in the live preview, and in the SVG every file is drawn from: a wrapped Blob). The picture is then read as a
 * reader would see it: the preview from the screen (CDP, which does not wait for the fonts the way Playwright's
 * screenshot does), a file from the download, opened the way a viewer opens it (a PDF's own JPEG). The gap is
 * the first red column minus the last blue column, on the rows the year's ink covers, in the art's units
 * (1800 across). Overlap comes out negative.
 *
 * Options to open(): fonts "late" (the print fonts held back delayMs), "failed" (never come), and
 * measure: "georgia" (the art measures its words in Georgia while Fraunces draws them: the web font not in
 * yet when it measures, or a browser measuring another instance of the variable font than it draws). */
import { readFileSync } from "node:fs";
import { PW, CHROME, serve, mocks } from "./rp-chetek-oct21.mjs";
import { makerFlag } from "./rp-maker.mjs";
export { PW, CHROME };

const IN_PAGE = `
window.__rcOn = null;
window.__recolorSvg = function (svg, a, b) {
  var hit = { a: 0, b: 0, size: 0, dx: null };
  svg.querySelectorAll('text').forEach(function (t) {
    if (+t.getAttribute('font-size') < 30) return;
    var own = Array.prototype.filter.call(t.childNodes, function (n) { return n.nodeType === 3; }).map(function (n) { return n.nodeValue; }).join('').trim();
    var sp = t.querySelectorAll('tspan');
    if (own === a) { t.setAttribute('fill', '#0000FF'); hit.a++; }
    if (!sp.length && own === b) { t.setAttribute('fill', '#FF0000'); hit.b++; hit.size = +t.getAttribute('font-size'); }
    sp.forEach(function (s) {
      if (s.textContent.trim() === b && own === a) { s.setAttribute('fill', '#FF0000'); hit.b++; hit.size = +s.getAttribute('font-size'); hit.dx = s.getAttribute('dx'); }
    });
  });
  return hit;
};
(function () {
  var OB = window.Blob;
  function NB(parts, opts) {
    if (opts && /svg/.test(opts.type || '') && typeof parts[0] === 'string') {
      var s = parts[0];
      if (window.__rcOn) {
        var d = new DOMParser().parseFromString(s, 'image/svg+xml');
        window.__rcHit = window.__recolorSvg(d.documentElement, window.__rcOn[0], window.__rcOn[1]);
        s = new XMLSerializer().serializeToString(d);
      }
      parts = [s];
    }
    return new OB(parts, opts);
  }
  NB.prototype = OB.prototype;
  window.Blob = NB;
})();
window.__gapOf = function (url) {
  return new Promise(function (ok, bad) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = img.naturalWidth || 1800; c.height = img.naturalHeight || 1200;
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      var D = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
      var red = function (i) { return D[i] > 200 && D[i + 1] < 70 && D[i + 2] < 70; };
      var blue = function (i) { return D[i + 2] > 200 && D[i] < 70 && D[i + 1] < 70; };
      var rMin = 1e9, rMax = -1, yMin = 1e9, yMax = -1, y, xx, i;
      for (y = 0; y < H; y++) for (xx = 0; xx < W; xx++) { i = (y * W + xx) * 4; if (red(i)) { if (xx < rMin) rMin = xx; if (xx > rMax) rMax = xx; if (y < yMin) yMin = y; if (y > yMax) yMax = y; } }
      if (rMax < 0) return ok({ err: 'no year ink found', w: W, h: H });
      var bMax = -1;
      for (y = yMin; y <= yMax; y++) for (xx = 0; xx < W; xx++) { i = (y * W + xx) * 4; if (blue(i) && xx > bMax) bMax = xx; }
      if (bMax < 0) return ok({ err: 'no name ink on the year line', w: W, h: H });
      ok({ px: rMin - bMax - 1, w: W, h: H, red: [rMin, yMin, rMax, yMax], blueEnd: bMax });
    };
    img.onerror = function () { bad(new Error('the picture did not open')); };
    img.src = url;
  });
};`;
const GEORGIA = `(function () { var v; Object.defineProperty(window, 'AgRainArt', { configurable: true, get: function () { return v; }, set: function (x) {
  var r = x.render; x.render = function (I) { var c = document.createElement('canvas').getContext('2d');
    return r.call(x, Object.assign({}, I, { measure: function (s, o) { c.font = (o.it ? 'italic ' : '') + o.w + ' ' + o.size + 'px Georgia'; return c.measureText(String(s)).width; } })); }; v = x; } }); })();`;

export async function open(root, { fonts = "loaded", delayMs = 8000, measure = "", width = 1280 } = {}) {
  const srv = await serve(root), base = "http://127.0.0.1:" + srv.address().port;
  const { chromium } = await import(PW);
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, serviceWorkers: "block", acceptDownloads: true });
  await context.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
  await mocks(context, { worker: "ok" });
  await makerFlag(context);
  await context.addInitScript(IN_PAGE);
  if (measure === "georgia") await context.addInitScript(GEORGIA);
  if (fonts !== "loaded") await context.route(/\/fonts\/rp-(fraunces|plex-sans)/, async (r) => {
    if (fonts === "failed") return r.abort();
    await new Promise((ok) => setTimeout(ok, delayMs)); return r.continue().catch(() => {});
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  return { page, base, errors, close: async () => { await browser.close(); srv.close(); } };
}
export async function drawn(page) {
  await page.waitForFunction(() => /days recorded|from Chetek/.test(document.getElementById("rp-source").textContent) && !document.getElementById("rp-go").disabled && document.querySelector("#rp-art svg"), null, { timeout: 40000 });
}
export async function fontsLoaded(page) {
  await page.waitForFunction(() => [...document.fonts].some((f) => /Fraunces/.test(f.family) && f.status === "loaded") && document.fonts.status === "loaded", null, { timeout: 30000 });
}
export const printFontIn = (page) => page.evaluate(() => [...document.fonts].some((f) => /Fraunces/.test(f.family) && f.status === "loaded"));

// a: the words before the year, b: the year; scale: picture pixels per art unit (null: width / 1800)
const units = (g, scale) => (g.err ? g : { ...g, u: +(g.px / (scale || g.w / 1800)).toFixed(1) });
export async function previewGap(page, a, b, shotPath) {
  const hit = await page.evaluate(([a, b]) => window.__recolorSvg(document.querySelector("#rp-art svg"), a, b), [a, b]);
  await page.$eval("#rp-art svg", (el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const bb = await page.$eval("#rp-art svg", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
  const cdp = await page.context().newCDPSession(page);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...bb, scale: 1 }, captureBeyondViewport: true });
  if (shotPath) (await import("node:fs")).writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  const g = await page.evaluate((u) => window.__gapOf(u), "data:image/png;base64," + shot.data);
  return { ...units(g, null), hit, path: "preview" };
}
// sel: a maker button; scale for the 13 x 19 sheet (the art 16.5 in of it at 300 dpi)
export async function fileGap(page, sel, a, b, scale = null) {
  await page.evaluate(([a, b]) => { window.__rcOn = [a, b]; }, [a, b]);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.click(sel)]);
  const bytes = readFileSync(await dl.path()), file = dl.suggestedFilename();
  let url;
  if (/\.svg$/.test(file)) url = "data:image/svg+xml;base64," + bytes.toString("base64");
  else if (/\.png$/.test(file)) url = "data:image/png;base64," + bytes.toString("base64");
  else if (/\.pdf$/.test(file)) {
    const s = bytes.toString("latin1"), i = s.indexOf("stream\n", s.indexOf("/DCTDecode")) + 7, j = s.indexOf("\nendstream", i);
    url = "data:image/jpeg;base64," + bytes.subarray(i, j).toString("base64");
  }
  const g = await page.evaluate((u) => window.__gapOf(u), url);
  const hit = await page.evaluate(() => { const h = window.__rcHit; window.__rcOn = null; return h; });
  return { ...units(g, scale), hit, path: file, svg: /\.svg$/.test(file) ? bytes.toString("utf8") : null };
}
export const SHEET_SCALE = 16.5 * 300 / 1800;
export const BTN = {
  svg: '#rp-maker button[data-fmt="svg"]',
  digitalPng: '#rp-maker button[data-size="digital"][data-fmt="png"]',
  digitalPdf: '#rp-maker button[data-size="digital"][data-fmt="pdf"]',
  sheetPdf: '#rp-maker button[data-size="12x18"][data-fmt="pdf"]:not([data-qr])',
};
