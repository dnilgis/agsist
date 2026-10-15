/* Grain EMC (components/grain-emc.js, grain-emc-ui.js) and the /grain-emc page.
 *
 * The shipped files run here, so a green run checks the copy the browser
 * runs. Hand-worked answers are written out so a reader can redo them. The
 * browser checks need Playwright and Chromium and are skipped without them.
 *
 *   node --test test/grain-emc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { bake } from "../scripts/build_grain_emc.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/grain-emc.js", "utf8"), ctx);
const E = ctx.AgEMC;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const page = readFileSync(ROOT + "grain-emc.html", "utf8");
const ui = readFileSync(ROOT + "components/grain-emc-ui.js", "utf8");
const H = (o) => Object.assign({ mode: "hold", grain: "corn", target: 15.5, fan: 0 }, o);

/* ---------------- equations ---------------- */

test("constants are the checked sets, and soybeans stay off", () => {
  const [cp, he] = E.GRAINS.corn.fits;
  assert.deepEqual([cp.model, cp.A, cp.B, cp.C], ["chung-pfost", 374.34, 0.18662, 31.696]);
  assert.deepEqual([he.model, he.K, he.N, he.C], ["henderson", 8.6541e-5, 1.8634, 49.81]);
  const w = E.GRAINS.wheat.fits[0];
  assert.deepEqual([w.model, w.K, w.N, w.C], ["henderson", 2.3007e-5, 2.2857, 55.815]);
  assert.deepEqual([...Object.keys(E.GRAINS)], ["corn", "wheat"]);
  assert.match(page, /<p class="emc-soy">Soybeans: not yet\. Corn numbers do not fit beans\./);
});

test("corn at 50 F and 60%, worked by hand on both fits", () => {
  // Chung-Pfost: T = 10 C; -ln 0.6 = 0.510826 x 41.696 / 374.34 = 0.056898; -ln = 2.86650; / 0.18662 = 15.360 dry, 13.315 wet.
  // Henderson: -ln 0.4 = 0.916291 / (8.6541e-5 x 59.81) = 177.03; ^(1/1.8634) = 16.085 dry, 13.856 wet.
  const e = E.emc("corn", 50, 60);
  near(e.wb, 13.315, 0.002, "Chung-Pfost");
  near(e.wet, 13.856, 0.003, "Henderson, the wetter");
});

test("wheat reproduces the University of Minnesota Extension table at 60 F", () => {
  for (const [rh, pub] of [[20, 7.9], [40, 11.0], [60, 13.7], [80, 16.9]]) near(E.emc("wheat", 60, rh).wb, pub, 0.06, `wheat 60 F ${rh}%`);
});

const TABLES = [
  ["UMN", 40, 50, 13.1], ["UMN", 40, 60, 14.5], ["UMN", 40, 70, 16.0], ["UMN", 40, 80, 17.9],
  ["UMN", 50, 50, 12.5], ["UMN", 50, 60, 13.8], ["UMN", 50, 70, 15.4],
  ["UMN", 60, 50, 11.4], ["UMN", 60, 60, 12.9], ["UMN", 60, 70, 14.5],
  ["KY", 40, 50, 12.9], ["KY", 40, 60, 14.5], ["KY", 40, 70, 16.2],
  ["KY", 50, 50, 12.3], ["KY", 50, 60, 13.8], ["KY", 50, 70, 15.5],
  ["KY", 70, 50, 11.3], ["KY", 70, 60, 12.8], ["KY", 70, 70, 14.4],
  ["AR", 60, 70, 15.7], ["AR", 75, 75, 15.7], ["AR", 75, 85, 17.9],
];

test("corn 'dries to target' is safe against every published table cell, for every target the box allows", () => {
  // A dries call needs Chung-Pfost <= T - 1 and Henderson <= T. For each table
  // cell, the published EMC must then be under T, whatever T is: the cell's
  // value must not exceed max(CP + 1, HE).
  for (const [src, t, rh, v] of TABLES) {
    const e = E.emc("corn", t, rh);
    const worstDryCall = Math.max(e.wb + E.MARGIN, e.wet);
    assert.ok(v <= worstDryCall + 0.05 || src === "AR", `${src} ${t} F ${rh}%: table ${v} over ${worstDryCall.toFixed(2)}`);
    for (let T = E.LIMITS.targetMin; T <= E.LIMITS.targetMax; T += 0.5) {
      const call = E.holdCall("corn", e, T);
      if (call === "dry" && src !== "AR") assert.ok(v < T + 0.05, `${src} ${t} F ${rh}% T ${T}: dry call but table ${v}`);
    }
  }
  // Arkansas runs wetter than both fits (e.g. 15.7 at 60 F/70%); the page prints that gap.
  assert.match(page, /<th scope="row">60 F, 70%<\/th><td>14\.2 to 15\.1%<\/td><td>14\.5%<\/td><td>no row<\/td><td>15\.7%<\/td>/);
});

test("the spread table prints what the equations give", () => {
  const show = (t, rh) => { const e = E.emc("corn", t, rh); return `${e.wb.toFixed(1)} to ${e.wet.toFixed(1)}%`; };
  assert.equal(show(40, 70), "15.3 to 16.4%");
  assert.equal(show(50, 60), "13.3 to 13.9%");
  assert.equal(show(60, 70), "14.2 to 15.1%");
  for (const [t, rh] of [[40, 70], [50, 60], [60, 70]]) assert.ok(page.includes(`<th scope="row">${t} F, ${rh}%</th><td>${show(t, rh)}</td>`), `${t}/${rh}`);
  assert.equal(E.emc("wheat", 60, 70).wb.toFixed(1), "15.2");
});

test("humidity limits: FAQ ranges and the baked table carry the margin", () => {
  const f = (t, fit) => E.rhFor("corn", t, 15.5, fit).rh;
  assert.deepEqual([40, 50, 60].map((t) => [Math.round(f(t, 1)), Math.round(f(t, 0))]), [[65, 71], [69, 75], [72, 77]]);
  assert.match(page, /about 65 to 71% humidity at 40 F, 69 to 74% at 50 F and 72 to 77% at 60 F/);
  assert.deepEqual([40, 50, 60].map((t) => Math.floor(E.rhDries("corn", t, 15.5).rh)), [64, 68, 71]);
  assert.match(page, /under about 64% at 40 F, 68% at 50 F and 71% at 60 F/);
  // holds uses the wetter fit (the lower humidity), never Chung-Pfost alone
  for (const t of [30, 50, 70, 90]) near(E.rhFor("corn", t, 15.5).rh, Math.min(f(t, 0), f(t, 1)), 1e-9, `holds ${t}`);
  for (const k of ["corn", "wheat"]) for (const t of [25, 55, 95]) {
    const r = E.rhFor(k, t, 14, 0);
    near(E.emc(k, t, r.rh).wb, 14, 1e-9, `${k} inverse ${t}`);
  }
});

test("baked charts and limits match the module (scripts/build_grain_emc.mjs --check)", () => {
  assert.equal(bake(page), page, "run node scripts/build_grain_emc.mjs");
  assert.match(page, /<h2 id="corn-chart">Corn EMC chart<\/h2>/);
  assert.match(page, /<h2 id="wheat-chart">Wheat EMC chart<\/h2>/);
  const corn = page.match(/<section class="emc-chart" id="corn-emc-chart"[\s\S]*?<\/section>/)[0];
  for (const t of [30, 40, 50, 60, 70, 80, 90]) assert.ok(corn.includes(`<th scope="row">${t} F</th>`), `row ${t}`);
  const e = E.emc("corn", 50, 60);
  assert.ok(corn.includes(`<span>${e.wb.toFixed(1)}</span><span class="hi">${e.wet.toFixed(1)}</span>`));
  assert.match(page, /A G S I S T &nbsp;&middot;&nbsp; agsist\.com\/grain-emc &nbsp;&middot;&nbsp; free tools for working farmers/);
  assert.match(page, /data-print-chart="corn"/);
});

/* ---------------- calls ---------------- */

test("fan heat: Magnus form, and no reading means no answer (B1)", () => {
  near(E.satVp(10), 12.2602, 1e-3, "es at 10 C");
  const w = E.warm(50, 80, 5);
  assert.equal(w.tF, 55);
  near(w.rh, 66.567, 0.01, "rh after the fan");
  near(E.unwarmRh(50, w.rh, 5), 80, 1e-9, "inverse");
  assert.equal(E.warm(null, 60, 3), null);
  assert.equal(E.warm(50, null, 3), null);
  const a = E.assess(H({ fan: 3 }), null, 60);
  assert.equal(a.call, null, "a missing hour with fan heat is not 'dry'");
  assert.equal(E.assess(H({ mode: "dry", current: 20, fan: 3 }), 50, null).call, null);
  assert.match(page, /50 F at 80%, warmed 5 F, comes in at 55 F and 67%/);
});

test("rounding: the call is made on the number shown (B5)", () => {
  // CP rounds to 14.5 at the edge of the margin -> dry, matching the shown 14.5
  const e = { ok: true, wb: 14.54, wet: 15.2, bound: null };
  assert.equal(E.holdCall("corn", e, 15.5), "dry");
  assert.equal(E.holdCall("corn", { ok: true, wb: 14.56, wet: 15.2, bound: null }, 15.5), "close");
  assert.equal(E.holdCall("corn", { ok: true, wb: 14.8, wet: 15.54, bound: null }, 15.5), "close", "15.54 shows 15.5: not over");
  assert.equal(E.holdCall("corn", { ok: true, wb: 14.8, wet: 15.56, bound: null }, 15.5), "wet");
});

test("fog: over 90% wets a high target when the air at its real humidity would (B7)", () => {
  const e = E.emc("corn", 50, 97);
  assert.equal(e.bound, "over");
  assert.ok(e.wet < 22, "90% floor is under 22");
  assert.equal(E.holdCall("corn", e, 22), "wet", "97% air pushes corn past 22%");
  assert.equal(E.holdCall("corn", E.emc("corn", 50, 100), 20), "wet");
  assert.equal(E.holdCall("corn", e, 15.5), "wet");
  assert.equal(E.emc("corn", 19, 60).ok, false);
  assert.equal(E.emc("corn", 101, 60).ok, false);
  assert.equal(E.holdCall("wheat", E.emc("wheat", 60, 10), 13.5), "dry");
});

test("drying calls: against the grain's own moisture, three states, weather wets", () => {
  const o = H({ mode: "dry", current: 19 });
  assert.equal(E.assess(o, 50, 60).call, "dry", "13.3-13.9: dries to 15.5");
  assert.equal(E.assess(o, 45, 75).call, "part", "about 15.9-17.0: under 19 but not to target");
  assert.equal(E.assess(o, 45, 90).call, "wet", "about 18.6-20.6: wetter one over 19");
  assert.equal(E.assess(Object.assign({}, o, { wx: "fog" }), 50, 60).call, "wet");
  assert.equal(E.assess(Object.assign({}, o, { current: null }), 50, 60).call, null);
  assert.equal(E.wxKind(45), "fog"); assert.equal(E.wxKind(61), "rain"); assert.equal(E.wxKind(73), "snow"); assert.equal(E.wxKind(3), null);
  const rows = Array.from({ length: 48 }, (_, i) => ({ tF: 35, rh: 80 }));
  assert.deepEqual([...E.dryWarnings(rows).map((w) => w.kind)], ["cold", "humid"]);
  assert.equal(E.dryWarnings(rows.map(() => ({ tF: 55, rh: 60 }))).length, 0);
});

test("cooling calls: by temperature at the fan, rain or fog skipped only for dry grain (B9)", () => {
  assert.equal(E.coolCall(45, 55, null, true), "cool");
  assert.equal(E.coolCall(50, 55, null, true), "mild");
  assert.equal(E.coolCall(56, 55, null, true), "warm");
  assert.equal(E.coolCall(45, 55, "fog", true), "skip");
  assert.equal(E.coolCall(45, 55, "fog", false), "cool");
  assert.equal(E.coolCall(10, 40, null, true), "cool", "under 20 F still cools");
  const a = E.assess(H({ mode: "cool", grainF: 56, fan: 6, grainDry: true }), 40, 95);
  assert.equal(a.fanTF, 46); assert.equal(a.call, "cool", "humid air still cools");
  assert.equal(E.assess(H({ mode: "cool", grainF: 50, fan: 6 }), 40, 60).call, "mild", "fan heat counts");
  assert.equal(E.coolingHours(0.1), 150);
  assert.equal(E.coolingHours(0), null);
});

test("runs and best window", () => {
  const rows = ["wet", "dry", "dry", "dry", "close", "dry", "dry", "wet"].map((c, i) => ({ call: c, emc: { ok: true, wet: 13 + i / 10 } }));
  assert.deepEqual(JSON.parse(JSON.stringify(E.runs(rows).map((r) => [r.call, r.len]))), [["wet", 1], ["dry", 3], ["close", 1], ["dry", 2], ["wet", 1]]);
  const b = E.bestWindow(rows, "dry", 2);
  assert.deepEqual([b.start, b.end, b.len], [1, 3, 3]);
  near(b.worst, 13.3, 1e-9, "worst");
  assert.equal(E.bestWindow(rows.slice(0, 1), "dry", 2), null);
});

/* ---------------- page copy ---------------- */

test("page: title, H1, byline, voice, structured data and the FAQ word for word", () => {
  assert.match(page, /<title>Grain EMC calculator: when to run aeration fans \| AGSIST<\/title>/);
  assert.match(page, /<h1>When to run aeration fans: will they dry your grain or wet it\?<\/h1>/);
  assert.match(page, /Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
  // Sig, Oct 15: no name in the hero; the byline sits at the bottom, after the credit line
  const h1At = page.indexOf("</h1>"), modeAt = page.indexOf('class="emc-seg emc-mode"'), byAt = page.indexOf('<p class="by">');
  assert.ok(byAt > page.indexOf('id="emc-credit"') && !page.slice(h1At, modeAt).includes("Sigurd"), "no byline in the hero");
  assert.ok(!/—|&mdash;/.test(page + ui), "no em dashes in the page or what the script writes (B15)");
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const g = ld["@graph"];
  assert.ok(g.some((x) => x["@type"] === "WebApplication" && x.offers.price === "0"));
  const faq = g.find((x) => x["@type"] === "FAQPage").mainEntity;
  const unesc = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const shown = [...page.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => [unesc(m[1]), unesc(m[2])]);
  assert.deepEqual(shown, faq.map((q) => [q.name, q.acceptedAnswer.text]));
  for (const q of faq) assert.ok(!/green hours|on this page those/i.test(q.acceptedAnswer.text), "FAQ answers stand alone");
  assert.ok(!/Cornell[^.]*15 divided/.test(page), "the 15/cfm rule is not credited to Cornell");
  assert.match(page, /about 15 divided by cfm per bushel \(NDSU, Iowa State and Nebraska Extension\)/);
  assert.match(page, /100 to 200 hours/);
  assert.ok(!/50x|50 times/.test(page + ui));
  assert.match(page, /Grain drying down settles a little wetter than grain taking on water/);
  assert.match(page, /src="\/components\/grain-emc\.js\?v=\d+"/);
  assert.ok(Buffer.byteLength(page) < 90000, "page stays small");
});

test("Zach A. is credited in three places, on the visible page only", () => {
  const credit = page.match(/<p id="emc-credit"[^>]*>([\s\S]*?)<\/p>/);
  assert.equal((page.match(/id="emc-credit"/g) || []).length, 1);
  assert.equal(credit[1], 'This tool exists because Zach A. emailed and asked for it. Have an idea for a tool? <a href="/contact">Tell me.</a>');
  const stamp = page.match(/<p id="emc-idea"[^>]*>([\s\S]*?)<\/p>/);
  assert.equal(stamp[1], "Idea by Zach A., a farmer who emailed and asked for it. Thanks, Zach.");
  assert.ok(page.indexOf('id="emc-idea"') < page.indexOf('id="emc-answer"'));
  assert.match(ui, /Best fan window \(Zach&rsquo;s window\)<\/button>/);
  assert.match(ui, /The longest run of good fan hours ahead\. Named for Zach A\., who asked for this tool\./);
  assert.ok(!/Zach/.test(page.slice(0, page.indexOf("</head>"))), "not in the title, meta or JSON-LD");
});

test("linked from the tools hub, grain bin calculator, store or sell, menus, sitemap, llms.txt and generated headers", () => {
  for (const f of ["tools.html", "grain-bin-calculator.html", "store-or-sell.html", "components/header.html", "components/footer.html", "arc-plc/iowa.html", "yield/iowa.html", "prf/iowa.html"]) {
    assert.match(readFileSync(ROOT + f, "utf8"), /href="\/grain-emc"/, f);
  }
  assert.match(readFileSync(ROOT + "sitemap.xml", "utf8"), /<loc>https:\/\/agsist\.com\/grain-emc<\/loc>/);
  assert.match(readFileSync(ROOT + "llms.txt", "utf8"), /\(https:\/\/agsist\.com\/grain-emc\)/);
});

/* ---------------- in the browser ---------------- */

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
/* An Open-Meteo answer in unix time for a zone, starting at local midnight. */
function forecast(zone, offsets, startIso, opts = {}) {
  const t0 = Date.parse(startIso) / 1000, time = [], t = [], rh = [], code = [];
  for (let i = 0; i < 96; i++) {
    time.push(t0 + i * 3600 + (offsets(i) || 0));
    t.push(opts.temp ? opts.temp(i) : 50);
    rh.push(opts.rh ? opts.rh(i) : 60);
    code.push(1);
  }
  return { timezone: zone, current: opts.current || { temperature_2m: t[20], relative_humidity_2m: rh[20], weather_code: 1 }, hourly: { time, temperature_2m: t, relative_humidity_2m: rh, weather_code: code } };
}
async function open(browser, port, { now, onForecast, settings, loc = true, width = 390 }) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 }, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  if (now) await pg.clock.install({ time: now });
  await pg.route("**/*", async (r) => {
    const u = r.request().url(), h = { "access-control-allow-origin": "*" };
    if (u.includes("api.open-meteo.com/v1/forecast")) return onForecast(r, u, h);
    if (u.includes("/bids/data/zips/")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify({ 54728: [45.31, -91.65], 78701: [30.27, -97.74] }) });
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.addInitScript(([loc, settings]) => {
    try {
      if (loc) localStorage.setItem("agsist-wx-loc", JSON.stringify({ lat: 45.31, lon: -91.65, label: "ZIP 54728" }));
      if (settings) localStorage.setItem("agsist-emc", JSON.stringify(settings));
    } catch (e) {}
  }, [loc, settings || null]);
  await pg.goto(`http://127.0.0.1:${port}/grain-emc`);
  return { pg, ctx, errors };
}

test("browser: a slow first answer never overwrites a newer location (B2), and the ZIP box takes any digits (B13)", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, srv.address().port, {
      loc: false, now: Date.parse("2026-10-15T20:00:00-05:00"),
      onForecast: async (r, u, h) => {
        const tx = u.includes("latitude=30.270");
        if (tx) await new Promise((ok) => setTimeout(ok, 1500));
        return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(forecast("America/Chicago", () => 0, "2026-10-15T00:00:00-05:00", { temp: () => (tx ? 90 : 45), rh: () => 50, current: { temperature_2m: tx ? 90 : 45, relative_humidity_2m: 50, weather_code: 1 } })) });
      },
    });
    await pg.fill("#emc-zip", "787-01");
    await pg.click("#emc-zipgo");
    await pg.waitForTimeout(200);
    await pg.fill("#emc-zip", " 54728 ");
    await pg.click("#emc-zipgo");
    await pg.waitForTimeout(2500);
    const now = await pg.textContent("#emc-now");
    assert.match(now, /45 F/, "Wisconsin air shows");
    assert.ok(!/90 F/.test(now), "late Texas reply dropped");
    assert.match(await pg.textContent("#emc-place"), /ZIP 54728/);
    assert.equal(await pg.getAttribute("#emc-zip", "maxlength"), null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: missing hours say 'no reading', DST hours label right, current falls back (B6, B8)", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    // Nov 1 2026 is the fall-back night in Chicago; Open-Meteo unix times step one hour each.
    const { pg, errors } = await open(browser, srv.address().port, {
      now: Date.parse("2026-10-31T20:30:00-05:00"),
      onForecast: (r, u, h) => {
        assert.match(u, /timeformat=unixtime/);
        const f = forecast("America/Chicago", () => 0, "2026-10-31T00:00:00-05:00", { temp: (i) => (i === 21 ? null : 45), rh: (i) => (i === 21 ? null : 50), current: { temperature_2m: null, relative_humidity_2m: null } });
        return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(f) });
      },
    });
    await pg.waitForSelector("#emc-results:not([hidden])");
    assert.match(await pg.textContent("#emc-now"), /Forecast air at tonight 8 pm: 45 F/);
    assert.ok(!/0 F, 0%/.test(await pg.textContent("#emc-now")));
    assert.match(await pg.textContent("#emc-count"), /1 with no forecast reading/);
    await pg.focus("#emc-strip");
    await pg.keyboard.press("ArrowRight");
    assert.match(await pg.textContent("#emc-tip"), /^Tonight 9 pm: no forecast reading\./);
    await pg.click("#emc-table summary");
    const hours = await pg.$$eval("#emc-tbl tbody th", (t) => t.map((x) => x.textContent));
    assert.equal(hours.filter((x) => x === "tonight 1 am").length, 2, "both 1 am hours of the fall-back night, in Chicago time");
    assert.equal(hours.filter((x) => x === "tonight 2 am").length, 1);
    assert.ok(hours.includes("Sun 1 pm") || hours.includes("tomorrow 1 pm"), "the day after reads by name");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: a forecast over 2 hours old that cannot refresh says so instead of a verdict (B3)", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    let calls = 0;
    const { pg } = await open(browser, srv.address().port, {
      now: Date.parse("2026-10-15T20:00:00-05:00"),
      onForecast: (r, u, h) => (++calls > 1 ? r.abort() : r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(forecast("America/Chicago", () => 0, "2026-10-15T00:00:00-05:00")) })),
    });
    await pg.waitForSelector("#emc-results:not([hidden])");
    await pg.clock.fastForward("02:30:00");
    await pg.evaluate(() => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })));
    await pg.waitForTimeout(500);
    assert.equal(calls, 2, "it tried to refresh");
    assert.match(await pg.textContent("#emc-verdict"), /Forecast is 2 hours old\. Refresh the page\./);
  } finally { await browser.close(); srv.close(); }
});

test("browser: bad saved or linked settings are ignored (B4); plenum box ignores fan heat (B16)", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, srv.address().port, { loc: false, settings: { mode: "hold", grain: "toString", targets: { corn: 99 }, fan: -4 }, onForecast: (r) => r.abort() });
    await pg.waitForTimeout(300);
    assert.equal(await pg.inputValue("#emc-target"), "15.5");
    assert.equal(await pg.inputValue("#emc-fan"), "0");
    await pg.goto(`http://127.0.0.1:${srv.address().port}/grain-emc?grain=constructor&target=55&fan=400`);
    await pg.waitForTimeout(300);
    assert.equal(await pg.getAttribute('[data-grain="corn"]', "aria-pressed"), "true");
    assert.equal(await pg.inputValue("#emc-target"), "15.5");
    await pg.fill("#emc-fan", "8"); await pg.dispatchEvent("#emc-fan", "change");
    await pg.click("#emc-manual summary");
    await pg.fill("#emc-mt", "50"); await pg.fill("#emc-mrh", "80");
    assert.match(await pg.textContent("#emc-mout"), /With the fan adding 8 F/);
    await pg.check("#emc-plenum");
    const t = await pg.textContent("#emc-mout");
    assert.ok(!/fan adding/.test(t), "plenum reading ignores fan heat");
    assert.match(t, /Fans wet it/);
  } finally { await browser.close(); srv.close(); }
});

test("browser: each EMC chart prints on exactly one Letter page with its title, every row and the footer", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const k of ["corn", "wheat"]) {
      const { pg, ctx } = await open(browser, srv.address().port, { loc: false, width: 1280, onForecast: (r) => r.abort() });
      await pg.waitForTimeout(200);
      await pg.evaluate((k) => document.documentElement.classList.add("print-chart", "print-" + k), k);
      await pg.emulateMedia({ media: "print" });
      const pdf = await pg.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      assert.equal(pages, 1, `${k}: ${pages} pages`);
      const vis = await pg.evaluate((k) => {
        const shown = (el) => el && getComputedStyle(el).display !== "none";
        const c = document.getElementById(k + "-emc-chart");
        return {
          title: shown(c.querySelector(".emc-ptitle")) && c.querySelector(".emc-ptitle").textContent,
          foot: shown(c.querySelector(".emc-pfoot")) && c.querySelector(".emc-print-foot").textContent,
          rows: c.querySelectorAll("tbody tr").length,
          others: [...document.querySelectorAll(".emc > *")].filter((e) => e !== c && shown(e)).length,
          header: shown(document.getElementById("site-header")),
          cellPt: parseFloat(getComputedStyle(c.querySelector("td")).fontSize) * 0.75,
        };
      }, k);
      assert.match(vis.title, new RegExp(`^${k === "corn" ? "Corn" : "Wheat"} EMC chart: equilibrium moisture content, % wet basis$`));
      assert.match(vis.foot, /A G S I S T\s+·\s+agsist\.com\/grain-emc\s+·\s+free tools for working farmers/);
      assert.equal(vis.rows, 7);
      assert.equal(vis.others, 0, "only the chart prints");
      assert.ok(!vis.header, "no site header on the chart print");
      assert.ok(vis.cellPt >= 11, `cells ${vis.cellPt} pt`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("the chart QR code reads back as the plain page link", { skip: process.env.JSQR_PATH && existsSync(process.env.JSQR_PATH) ? false : "set JSQR_PATH to check the QR" }, async () => {
  const jsQR = (await import(join(process.env.JSQR_PATH, "dist/jsQR.js"))).default;
  const q = {};
  vm.runInNewContext(readFileSync(ROOT + "components/qr.js", "utf8"), q);
  const m = q.AgQR.matrix("https://agsist.com/grain-emc"), s = 4, n = m.length + 8, W = n * s;
  const px = new Uint8ClampedArray(W * W * 4).fill(255);
  m.forEach((row, y) => row.forEach((v, x) => { if (!v) return; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const o = (((y + 4) * s + dy) * W + (x + 4) * s + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; } }));
  assert.equal(jsQR(px, W, W).data, "https://agsist.com/grain-emc");
  assert.ok(page.includes(q.AgQR.svg("https://agsist.com/grain-emc", "QR code: agsist.com/grain-emc")), "the baked QR is this symbol");
});
