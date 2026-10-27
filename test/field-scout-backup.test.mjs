/* Field Scout backup and restore (Oct 27, 2026; risk check item 5).
 * Saved fields, notes and photos live only in this device's storage (agsist-fs-fields).
 * "Back up all my fields" saves one file; "Restore from a backup" reads that file or a
 * one-field GeoJSON or KML export, shows what will change and asks before replacing.
 *
 *   node --test test/field-scout-backup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const CORE = read("field-scout.js"), BK = read("field-scout-backup.js"), HTML = read("field-scout.html");
const KEY = "agsist-fs-fields";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const r6 = (x) => +x.toFixed(6);   // saved outlines keep 6 decimals
const ring = (lat, lng) => [[lat, lng], [lat, lng + 0.01], [lat - 0.007, lng + 0.01], [lat - 0.007, lng]].map(([a, b]) => [r6(a), r6(b)]);
const FIELDS = [
  { id: 1761000000000, name: "Home 80", pts: ring(42.35, -93.40), acres: 78.4, notes: "Stand count 32k, light waterhemp on the east end", photos: [{ id: "p1", dataUrl: PNG, addedAt: 1761000100000 }, { id: "p2", dataUrl: PNG, addedAt: 1761000200000 }], editedAt: 1761000200000 },
  { id: 1761100000000, name: "North quarter", pts: ring(42.38, -93.42), acres: 158.9, notes: "", photos: [], editedAt: 1761100000000 },
  { id: 1761200000000, name: "Creek bottom", pts: ring(42.30, -93.35), acres: 41.2, notes: "Floods in a wet June", photos: [{ id: "p3", dataUrl: PNG, addedAt: 1761200100000 }], editedAt: 1761200100000 },
];
const SNAP = { at: 1761200000000, drought: 0, ndvi: 0.71 };

test("the backup code loads on its buttons by version, not on the first screen", () => {
  assert.match(CORE, /var FS_BACKUP_SRC='\/field-scout-backup\.js\?v=\d+'/);
  assert.doesNotMatch(HTML, /field-scout-backup\.js/);
  assert.match(BK, /^window\.__fsBackup = function \(FSX\) \{$/m);
  // nothing leaves the device: no fetch, no beacon, no form post in the backup code
  assert.doesNotMatch(BK, /fetch\(|sendBeacon|XMLHttpRequest|postJSON/);
  const mine = CORE.slice(CORE.indexOf("function renderSavedFields"), CORE.indexOf("Geo helpers"));
  assert.ok(mine.length > 500);
  assert.doesNotMatch(BK + mine, /\u2014/, "no em dashes in copy");
});

// The parser and the merge plan, run in plain node with a stand-in page
function loadModule(saved) {
  const flashes = [];
  const ctx = { window: {}, console, JSON, Date, Math, Number, String, Array, Object, isFinite, Error };
  vm.createContext(ctx);
  vm.runInContext(BK, ctx);
  const FSX = {
    esc: (s) => String(s), flashHint: (m) => flashes.push(m), ga: () => {}, PHOTO_CAP: 6,
    acresOfRing: (pts) => pts.length * 10, loadSavedFields: () => JSON.parse(JSON.stringify(saved)),
  };
  const raw = ctx.window.__fsBackup(FSX), plain = (o) => JSON.parse(JSON.stringify(o));   // out of the vm's own arrays
  const M = { parseFile: (t) => plain(raw.parseFile(t)), planRestore: (p, e) => plain(raw.planRestore(p, e)) };
  return { M, flashes };
}
const backupText = (fields, extra = {}) => JSON.stringify({ kind: "agsist-field-scout-backup", schema: 1, saved: "2026-10-27T12:00:00Z", fields, snaps: {}, ...extra });

test("a backup file is read back field for field; bad photos and bad outlines are dropped, not stored", () => {
  const { M } = loadModule([]);
  const evil = { ...FIELDS[1], id: 5, photos: [{ id: "x", dataUrl: 'javascript:alert(1)"' }, { id: "y", dataUrl: PNG + '" onerror="alert(1)' }] };
  const p = M.parseFile(backupText([...FIELDS, evil, { id: 6, name: "bad", pts: [[1, 2]] }, { id: 7, name: "far", pts: [[95, 0], [1, 1], [2, 2]] }]));
  assert.equal(p.source, "backup");
  assert.equal(p.fields.length, 4);
  assert.equal(p.skipped, 2);
  assert.deepEqual(p.fields.slice(0, 3), FIELDS);
  assert.deepEqual(p.fields[3].photos, [], "only real image data is kept as a photo");
});

test("a bad file is refused with a plain message", () => {
  const { M } = loadModule([]);
  const cases = [
    ["", /empty/],
    ["hello there", /not a Field Scout backup, a GeoJSON or a KML outline/],
    ['{"a":1}', /not a Field Scout backup/],
    [backupText(FIELDS, { schema: 9 }), /newer Field Scout/],
    [backupText([]), /no fields Field Scout can read/],
    ['{"type":"Feature","geometry":{"type":"Point","coordinates":[-93,42]}}', /no field outline/],
  ];
  for (const [text, re] of cases) assert.throws(() => M.parseFile(text), (e) => re.test(e.message), text.slice(0, 40));
});

test("GeoJSON outlines come in as [lat, lng] with the closing point dropped", () => {
  const { M } = loadModule([]);
  const g = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Lease 40" }, geometry: { type: "Polygon", coordinates: [[[-93.4, 42.35], [-93.39, 42.35], [-93.39, 42.343], [-93.4, 42.35]]] } }] };
  const p = M.parseFile(JSON.stringify(g));
  assert.equal(p.source, "GeoJSON");
  assert.equal(p.fields[0].name, "Lease 40");
  assert.deepEqual(p.fields[0].pts, [[42.35, -93.4], [42.35, -93.39], [42.343, -93.39]]);
  assert.equal(p.fields[0].id, null);
});

test("the plan adds new fields, leaves matching ones, asks on a changed one and keeps to 30", () => {
  const phone = [{ ...FIELDS[0], notes: "changed on the phone", editedAt: 1762000000000 }, FIELDS[1]];
  const { M } = loadModule(phone);
  const plan = M.planRestore(M.parseFile(backupText(FIELDS)), phone);
  assert.deepEqual(plan.add.map((f) => f.name), ["Creek bottom"]);
  assert.deepEqual(plan.same.map((s) => s.mine.name), ["North quarter"]);
  assert.equal(plan.conflict.length, 1);
  assert.equal(plan.conflict[0].useTheirs, false, "the newer edit (the phone's) is the one offered first");
  // room: 29 on the phone leaves space for one more
  const many = Array.from({ length: 29 }, (_, i) => ({ id: 100 + i, name: "F" + i, pts: ring(40 + i / 100, -90), acres: 10, notes: "", photos: [] }));
  const p2 = M.planRestore(M.parseFile(backupText(FIELDS)), many);
  assert.equal(p2.add.length, 1);
  assert.equal(p2.noRoom.length, 2);
  // the same outline from a KML or GeoJSON export of a saved field is not added twice
  const g = { type: "Polygon", coordinates: [FIELDS[1].pts.map(([a, b]) => [b, a])] };
  const p3 = M.planRestore(M.parseFile(JSON.stringify(g)), phone);
  assert.equal(p3.add.length, 0);
  assert.equal(p3.same.length, 1);
});

// ── In the browser ───────────────────────────────────────────────────
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/field-scout") p = "/field-scout.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.FS_BACKUP_SHOTS || "";

async function openPage(browser, port, width) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500 });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  pg.on("dialog", (d) => d.dismiss());
  await pg.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/field-scout`);
  await pg.waitForFunction(() => document.querySelector("#fs-map.leaflet-container"), null, { timeout: 20000 });
  return { pg, ctx, errors };
}
const stored = (pg) => pg.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), KEY);
async function reloadWith(pg, fields, extra = {}) {
  await pg.evaluate(([k, f, x]) => { localStorage.clear(); if (f) localStorage.setItem(k, JSON.stringify(f)); for (const n in x) localStorage.setItem(n, x[n]); }, [KEY, fields, extra]);
  await pg.reload();
  await pg.waitForFunction(() => document.querySelector("#fs-map.leaflet-container"), null, { timeout: 20000 });
}
async function pick(pg, name, text) {
  if (await pg.locator("#fs-restore [data-fsr=close]").count()) await pg.click("#fs-restore [data-fsr=close]");
  await pg.waitForFunction(() => !document.getElementById("fs-restore"), null, { timeout: 5000 });
  await pg.setInputFiles("#fs-restore-file", { name, mimeType: "application/octet-stream", buffer: Buffer.from(text) });
  await pg.waitForSelector("#fs-restore h3", { timeout: 10000 });
}
async function shot(pg, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await pg.locator("#fs-saved").scrollIntoViewIfNeeded();
  await pg.screenshot({ path: join(SHOTS, name + ".png") });
}

for (const width of [390, 1280]) {
  test(`in the browser at ${width}: backup, clear storage, restore gives the same fields; a bad file is refused; a conflict asks`, { skip }, async () => {
    const srv = await serve(), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const { pg, errors } = await openPage(browser, port, width);
      await reloadWith(pg, FIELDS, { ["agsist-fs-snap-" + FIELDS[2].id]: JSON.stringify(SNAP) });

      // three fields and no backup: a quiet reminder
      await pg.waitForSelector("#fs-bk-remind", { timeout: 5000 });
      assert.match(await pg.textContent("#fs-bk-remind"), /Your 3 fields, notes and photos live only on this device/);
      assert.match(await pg.textContent(".fs-bk-meta"), /No backup yet/);
      await shot(pg, `${width}-1-reminder`);

      // back up: one JSON file with every field, notes, photos, a schema and a date
      const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 15000 }), pg.click("#fs-backup")]);
      assert.match(dl.suggestedFilename(), /^agsist-field-scout-backup-\d{4}-\d{2}-\d{2}\.json$/);
      const file = readFileSync(await dl.path(), "utf8");
      const b = JSON.parse(file);
      assert.equal(b.kind, "agsist-field-scout-backup");
      assert.equal(b.schema, 1);
      assert.ok(Date.parse(b.saved) > Date.parse("2026-01-01"));
      assert.deepEqual(b.fields, FIELDS);
      assert.deepEqual(b.snaps, { [FIELDS[2].id]: SNAP });
      await pg.waitForFunction(() => !document.getElementById("fs-bk-remind"), null, { timeout: 5000 });
      assert.match(await pg.textContent(".fs-bk-meta"), /Last backup/);

      // a cleared phone: nothing saved, the restore is still there
      await reloadWith(pg, null);
      await pg.waitForSelector(".fs-bk-empty #fs-restore-btn", { timeout: 5000 });
      await shot(pg, `${width}-2-empty`);

      // a bad file is refused in plain words and nothing changes
      await pick(pg, "notes.json", "this is not a backup");
      assert.match(await pg.textContent("#fs-restore [role=alert]"), /not a Field Scout backup, a GeoJSON or a KML outline\. Nothing was changed\./);
      await shot(pg, `${width}-3-refused`);
      await pg.click("#fs-restore [data-fsr=close]");
      await pick(pg, "big.json", backupText(FIELDS, { schema: 7 }));
      assert.match(await pg.textContent("#fs-restore [role=alert]"), /newer Field Scout/);
      assert.deepEqual(await stored(pg), []);

      // restore: the preview says what will be added, then the fields come back exactly
      await pick(pg, dl.suggestedFilename(), file);
      assert.match(await pg.textContent("#fs-restore"), /Will be added \(3\)/);
      assert.deepEqual(await stored(pg), [], "nothing is written before Restore is pressed");
      await shot(pg, `${width}-4-preview`);
      await pg.click("#fs-restore [data-fsr=go]");
      await pg.waitForFunction(() => /Restored: 3 fields added/.test(document.getElementById("fs-restore").textContent), null, { timeout: 5000 });
      assert.deepEqual(await stored(pg), FIELDS);
      assert.deepEqual(await pg.evaluate((k) => JSON.parse(localStorage.getItem(k)), "agsist-fs-snap-" + FIELDS[2].id), SNAP);
      assert.equal(await pg.locator(".fs-saved-open").count(), 3);

      // restoring the same file again changes nothing
      await pick(pg, "again.json", file);
      assert.match(await pg.textContent("#fs-restore"), /Everything in this file is already on this phone/);
      await pg.click("#fs-restore [data-fsr=close]");

      // a conflict asks: the phone's copy is newer, so keeping it is offered first and nothing is overwritten
      const phone = FIELDS.map((f, i) => (i === 0 ? { ...f, notes: "Sprayed Oct 20", editedAt: Date.now() } : f));
      await reloadWith(pg, phone);
      await pick(pg, "backup.json", file);
      assert.match(await pg.textContent("#fs-restore"), /On this phone and in the backup, but different \(1\)/);
      assert.equal(await pg.isChecked('input[name="fsr-c0"][value="mine"]'), true);
      assert.equal(await pg.isChecked('input[name="fsr-c0"][value="theirs"]'), false);
      await shot(pg, `${width}-5-conflict`);
      await pg.click("#fs-restore [data-fsr=go]");
      await pg.waitForFunction(() => !document.getElementById("fs-restore"), null, { timeout: 5000 });
      assert.equal((await stored(pg))[0].notes, "Sprayed Oct 20", "keeping the phone's copy leaves it alone");
      // asked again, the reader picks the backup's copy
      await pick(pg, "backup.json", file);
      await pg.check('input[name="fsr-c0"][value="theirs"]');
      await pg.click("#fs-restore [data-fsr=go]");
      await pg.waitForFunction(() => /1 replaced/.test(document.getElementById("fs-restore").textContent), null, { timeout: 5000 });
      assert.deepEqual(await stored(pg), FIELDS);

      // a one-field KML export comes in as a new field with its name and acres
      const kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Lease 40</name><Placemark><name>Lease 40</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-93.5,42.2,0 -93.49,42.2,0 -93.49,42.193,0 -93.5,42.193,0 -93.5,42.2,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>';
      await pick(pg, "lease-40.kml", kml);
      assert.match(await pg.textContent("#fs-restore"), /Will be added \(1\)[\s\S]*Lease 40/);
      await pg.click("#fs-restore [data-fsr=go]");
      await pg.waitForFunction(() => /Restored: 1 field added/.test(document.getElementById("fs-restore").textContent), null, { timeout: 5000 });
      const after = await stored(pg);
      assert.equal(after.length, 4);
      assert.equal(after[3].name, "Lease 40");
      assert.deepEqual(after[3].pts, [[42.2, -93.5], [42.2, -93.49], [42.193, -93.49], [42.193, -93.5]]);
      assert.ok(after[3].acres > 150 && after[3].acres < 165, "acres from the outline (about 825 m by 778 m, 158 ac): " + after[3].acres);

      // no sideways scroll on a phone
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal scroll");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); srv.close(); }
  });
}
