/* /spray, Oct 16 benchmark fixes.
 *
 *   1. OTT dicamba is stopped by the label cutoff in every state, not only
 *      Minnesota and Illinois. The page has not read a 2026 label date at the
 *      source, so after June 30 (the latest calendar cutoff any OTT label or
 *      state rule has used) it rates no dicamba hour, and from June 13 it says
 *      to check the label date. An Iowa field on Oct 16 gets no "good" hour.
 *   2. The inversion row links the measured network for the field's state
 *      (MRCC list, fetched Oct 16: IA, IN, KS, MI, MO, ND/MN, SD live; plus
 *      Oklahoma's Drift Risk Advisor). "Kansas City, Missouri" is Missouri.
 *
 * Rules run from the spray-rules block in spray.html, the same copy the
 * browser runs. The last test needs Playwright and skips without it.
 *
 *   node --test test/spray-cutoff-network.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "spray.html", "utf8");
const m = HTML.match(/\/\* spray-rules:start \*\/([\s\S]*?)\/\* spray-rules:end \*\//);
function rules() {
  assert.ok(m, "spray.html has a spray-rules block");
  const ctx = { Date, document: { getElementById: () => null } };
  vm.runInNewContext(m[1] + "\nthis.R={dicambaStatus,dicambaDay,DICAMBA_STATES,PRODUCTS,invKey,INV_NETS};", ctx);
  return ctx.R;
}
const day = (ds, hi) => ({ time: [ds, ds.slice(0, 8) + String(+ds.slice(8) + 1).padStart(2, "0")], temperature_2m_max: hi, sunrise: [ds + "T05:30", null], sunset: [ds + "T21:00", null] });

test("Iowa on Oct 16: OTT dicamba is blocked by the label cutoff, named in the reason", () => {
  const R = rules(), D = R.PRODUCTS.dicamba;
  const d = day("2026-10-16", [61, 60]);
  const st = R.dicambaStatus(D, d, new Date("2026-10-16T10:00"), 0, null, 61);
  assert.equal(st.level, "block");
  assert.match(st.reason, /June 30/);
  assert.match(st.reason, /R1/);
  assert.match(st.reason, /V4 for Tavium/);
  assert.equal(R.dicambaDay(d, 0, null).level, "block");
  // July 1 anywhere, cool day, mid-morning: still blocked.
  assert.equal(R.dicambaStatus(D, day("2026-07-01", [78, 78]), new Date("2026-07-01T10:00"), 0, null, 75).level, "block");
  // June 30 itself is not past June 30: a caution to check the label date.
  const j30 = R.dicambaStatus(D, day("2026-06-30", [78, 78]), new Date("2026-06-30T10:00"), 0, null, 75);
  assert.equal(j30.level, "caution");
  assert.match(j30.reason, /cutoff date on your label/);
});

test("before June 13 a cool day with no state rule is not held back by the date", () => {
  const R = rules(), D = R.PRODUCTS.dicamba;
  assert.equal(R.dicambaStatus(D, day("2026-06-05", [78, 78]), new Date("2026-06-05T10:00"), 0, null, 75), null);
  assert.equal(R.dicambaDay(day("2026-06-05", [78, 78]), 0, null), null);
});

test("Minnesota and Illinois keep their own, more specific reason after their dates", () => {
  const R = rules(), D = R.PRODUCTS.dicamba;
  const il = R.dicambaStatus(D, day("2026-07-10", [80, 80]), new Date("2026-07-10T10:00"), 0, R.DICAMBA_STATES.IL, 75);
  assert.equal(il.level, "block");
  assert.match(il.reason, /Illinois rule/);
});

test("the measured network is found by exact state name, last part first", () => {
  const R = rules();
  assert.equal(R.invKey("Ames, Story County, Iowa, United States"), "Iowa");
  assert.equal(R.invKey("Kansas City, Jackson County, Missouri, United States"), "Missouri");
  assert.equal(R.invKey("Michigan City, LaPorte County, Indiana, 46360, United States"), "Indiana");
  assert.equal(R.invKey("North Dakota"), "North Dakota");
  assert.equal(R.invKey("Arkansas"), "");
  assert.equal(R.invKey("Nebraska"), "");
  assert.equal(R.invKey(undefined), "");
  for (const s of ["Iowa", "Indiana", "Kansas", "Michigan", "Missouri", "North Dakota", "Minnesota", "South Dakota", "Oklahoma"]) {
    const n = R.INV_NETS[s];
    assert.ok(n && /^https?:\/\//.test(n.u) && n.n, s);
  }
  // Illinois and Kentucky were "Coming Soon" on the MRCC list: no link until they are live.
  assert.equal(R.INV_NETS.Illinois, undefined);
  assert.equal(R.INV_NETS.Kentucky, undefined);
  assert.equal(R.INV_NETS.Minnesota.u, R.INV_NETS["North Dakota"].u);
});

test("page copy: no em dashes in the new lines, the cutoff is explained in the dicamba rules", () => {
  assert.match(HTML, /after June 30 it rates no dicamba window in any state/);
  assert.match(HTML, /mrcc\.purdue\.edu\/climate_watch\/special_topics\/tempinversion/);
  const block = m[1];
  for (const ln of block.split("\n").filter((l) => /INV_NETS|DICAMBA_LABEL|DICAMBA_STAGE|Measured inversion/.test(l))) {
    assert.doesNotMatch(ln, /—/, ln.slice(0, 80));
  }
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/spray") p = "/spray.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in the browser: a saved Kansas field shows the Kansas Mesonet link under the inversion row", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/spray`);
    await pg.evaluate(() => localStorage.setItem("agsist-spray-net", "Kansas"));
    await pg.reload();
    await pg.waitForFunction(() => { const e = document.getElementById("fc-inv-net"); return e && !e.hidden; });
    const t = await pg.$eval("#fc-inv-net", (e) => e.textContent);
    assert.match(t, /Measured inversion near you: Kansas Mesonet/);
    assert.equal(await pg.$eval("#fc-inv-net a", (a) => a.href), "https://mesonet.k-state.edu/agriculture/inversion/");
    await pg.evaluate(() => localStorage.setItem("agsist-spray-net", ""));
    await pg.reload();
    await pg.waitForTimeout(300);
    assert.equal(await pg.$eval("#fc-inv-net", (e) => e.hidden), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
