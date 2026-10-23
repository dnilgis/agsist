/* Storm replay over your field (components/storm-replay-core.js): the clock,
 * the share link, NOAA's time lists, hail at the field, reports near it, the
 * lightning count and the caption, all from a made-up storm
 * (test/fixtures/storm-replay/storm.mjs). The browser side is
 * test/storm-replay-browser.test.mjs.
 *
 *   node --test test/storm-replay.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as F from "./fixtures/storm-replay/storm.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const C = createRequire(import.meta.url)("../components/storm-replay-core.js");
const TZ = "America/Chicago";
const H = 3600e3, MIN = 60e3;

function fixtureCaption(over = {}) {
  const hours = C.hailHours(F.hours(), F.FIELD.lat, F.FIELD.lon, F.START, F.END);
  const list = C.lsrHail(F.lsr(), F.FIELD.lat, F.FIELD.lon, F.START, F.END);
  const rd = F.lightningTimes().filter((t) => t > F.START && t <= F.END).map((t) => ({ t, v: F.fieldDensity(t) }));
  const lt = C.lightningStrikes(rd);
  return C.caption(Object.assign({
    start: F.START, end: F.END, tz: TZ,
    hail: { ok: true, hours, coverage: C.hoursCoverage(F.hours(), F.START, F.END) },
    reports: { ok: true, list },
    rain: { ok: true, v: 120, start: F.START, end: F.END },
    lightning: Object.assign({ ok: true }, lt),
  }, over));
}

/* ---------- the clock ---------- */
test("24 hours is 97 frames every 15 minutes; 48 hours is 97 frames every 30", () => {
  const e = Date.UTC(2026, 6, 15, 12, 0);
  const a = C.frameTimes(e, 24, 15), b = C.frameTimes(e, 48, 30);
  assert.equal(a.length, 97);
  assert.equal(a[0], e - 24 * H);
  assert.equal(a[96], e);
  assert.ok(a.every((t, i) => i === 0 || t - a[i - 1] === 15 * MIN));
  assert.equal(b.length, 97);
  assert.equal(b[0], e - 48 * H);
  assert.deepEqual(C.windowSpec("48"), { hours: 48, step: 30 });
  assert.deepEqual(C.windowSpec("7"), { hours: 24, step: 15 }, "anything else is 24 hours");
});

test("the newest frame waits for the radar mosaic to post, on the step", () => {
  // 7:12 AM: 10 minutes back is 7:02, snapped to 7:00
  assert.equal(C.latestEnd(F.NOW, 15), Date.UTC(2026, 6, 15, 12, 0));
  // 7:09 AM: 6:59 snaps to 6:45
  assert.equal(C.latestEnd(Date.UTC(2026, 6, 15, 12, 9), 15), Date.UTC(2026, 6, 15, 11, 45));
  assert.equal(C.latestEnd(Date.UTC(2026, 6, 15, 12, 9), 30), Date.UTC(2026, 6, 15, 11, 30));
});

test("radar tiles ask for an exact 5-minute mosaic from the Iowa Environmental Mesonet", () => {
  const u = C.radarTileUrl(Date.UTC(2026, 6, 15, 2, 47));
  assert.equal(u, "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-202607150245/{z}/{x}/{y}.png");
  assert.equal(C.stamp(Date.UTC(2026, 0, 5, 3, 4)), "202601050304");
  assert.equal(C.parseStamp("202601050304"), Date.UTC(2026, 0, 5, 3, 4));
  assert.equal(C.parseStamp("202602300304"), null, "Feb 30 is not a time");
  assert.equal(C.parseStamp("2026"), null);
});

/* ---------- NOAA's advertised times ---------- */
test("NOAA time lists: a list, an interval, and the right layer out of several", () => {
  assert.deepEqual(C.parseTimeDimension("2026-07-15T02:15:00Z, 2026-07-15T02:00:00.000Z,2026-07-15T02:00:00Z"),
    [Date.UTC(2026, 6, 15, 2, 0), Date.UTC(2026, 6, 15, 2, 15)]);
  const iv = C.parseTimeDimension("2026-07-15T00:00:00Z/2026-07-15T01:00:00Z/PT15M");
  assert.equal(iv.length, 5);
  assert.equal(iv[4] - iv[0], H);
  const times = F.lightningTimes();
  const xml = F.capsXml("ldn_lightning_strike_density", times);
  const got = C.capsTimes(xml, "ldn_lightning_strike_density");
  assert.equal(got.length, times.length);
  assert.equal(got[got.length - 1], times[times.length - 1]);
  assert.equal(C.capsTimes(xml, "not_there"), null);
  assert.deepEqual(C.capsTimes(xml, "other_layer"), [Date.UTC(2020, 0, 1)], "the second layer's own times, not the first's");
});

test("each frame takes the newest NOAA map in its window, never a far one", () => {
  const ts = [Date.UTC(2026, 6, 15, 2, 0), Date.UTC(2026, 6, 15, 2, 15), Date.UTC(2026, 6, 15, 2, 30)];
  assert.equal(C.matchTime(ts, Date.UTC(2026, 6, 15, 2, 20), 15, 2), ts[1]);
  assert.equal(C.matchTime(ts, Date.UTC(2026, 6, 15, 2, 29), 15, 2), ts[2], "a map 1 minute after the frame is the same moment");
  assert.equal(C.matchTime(ts, Date.UTC(2026, 6, 15, 3, 0), 15, 2), null, "half an hour after the last map: no map, said so");
  assert.equal(C.matchTime(ts, Date.UTC(2026, 6, 15, 1, 0), 15, 2), null, "before NOAA's oldest map: no map");
});

/* ---------- the share link ---------- */
test("a share link carries place, window, layers and frame, and opens exactly that replay", () => {
  const v = { lat: 45.36, lon: -91.7, label: "ZIP 54728 (Chetek)", hours: 24, end: F.END, frame: Date.UTC(2026, 6, 15, 3, 15),
    layers: { radar: true, lightning: false, swaths: true, reports: true, clouds: true } };
  const q = C.encodeShare(v);
  assert.equal(q, "?sr=1&la=45.3600&lo=-91.7000&n=ZIP%2054728%20(Chetek)&h=24&e=202607151200&f=202607150315&ly=rspc");
  // opened two days later, it is still the same replay, not "now"
  const back = C.decodeShare(q, F.NOW + 48 * H);
  assert.equal(back.lat, 45.36); assert.equal(back.lon, -91.7);
  assert.equal(back.label, "ZIP 54728 (Chetek)");
  assert.equal(back.hours, 24); assert.equal(back.step, 15);
  assert.equal(back.end, F.END); assert.equal(back.frame, v.frame);
  assert.deepEqual(back.layers, v.layers);
  assert.equal(back.live, false);
  assert.equal(C.encodeShare(back), q, "round trip");
  const q48 = C.encodeShare(Object.assign({}, v, { hours: 48, frame: Date.UTC(2026, 6, 14, 3, 30) }));
  const b48 = C.decodeShare(q48, F.NOW);
  assert.equal(b48.hours, 48); assert.equal(b48.frame, Date.UTC(2026, 6, 14, 3, 30));
});

test("a bad or hand-made share link falls back safely", () => {
  assert.equal(C.decodeShare("?la=45&lo=-91", F.NOW), null, "not a replay link");
  assert.equal(C.decodeShare("?sr=1&la=95&lo=-91", F.NOW), null, "no such place");
  const noEnd = C.decodeShare("?sr=1&la=45.36&lo=-91.7", F.NOW);
  assert.equal(noEnd.end, C.latestEnd(F.NOW, 15), "no end: the latest replay");
  assert.equal(noEnd.frame, noEnd.end);
  assert.deepEqual(noEnd.layers, C.DEFAULT_LAYERS);
  const future = C.decodeShare("?sr=1&la=45.36&lo=-91.7&e=209901010000&f=209901010000", F.NOW);
  assert.equal(future.end, C.latestEnd(F.NOW, 15), "an end in the future is the latest replay");
  const offGrid = C.decodeShare("?sr=1&la=45.36&lo=-91.7&e=202607151200&f=202607150322&ly=r", F.NOW);
  assert.equal(offGrid.frame, Date.UTC(2026, 6, 15, 3, 15), "a frame off the 15-minute grid snaps to the nearest");
  const outside = C.decodeShare("?sr=1&la=45.36&lo=-91.7&e=202607151200&f=202607010000", F.NOW);
  assert.equal(outside.frame, F.START, "a frame before the window is its first frame");
  assert.deepEqual(C.parseLayers("x"), C.DEFAULT_LAYERS);
  assert.deepEqual(C.parseLayers(""), { radar: false, lightning: false, swaths: false, reports: false, clouds: false });
});

/* ---------- our data at the field ---------- */
test("radar hail at the field comes hour by hour, holes stay holes", () => {
  const hh = C.hailHours(F.hours(), F.FIELD.lat, F.FIELD.lon, F.START, F.END);
  assert.deepEqual(hh.map((h) => [new Date(h.end).toISOString().slice(11, 16), h.maxIn, h.onField]), [["03:00", 0.75, true], ["04:00", 1, true]]);
  // a ring of hail with a quiet middle: the middle is not hail
  const ring = (r) => Array.from({ length: 33 }, (_, k) => [-91.7 + r * Math.cos(k / 32 * 2 * Math.PI), 45.36 + r * Math.sin(k / 32 * 2 * Math.PI)]);
  const donut = { type: "MultiPolygon", coordinates: [[ring(0.2), ring(0.1)]] };
  assert.equal(C.inGeom(45.36, -91.7, donut), false);
  assert.equal(C.inGeom(45.36 + 0.15, -91.7, donut), true);
  const east = 0.1 * 69.17 * Math.cos(45.36 * Math.PI / 180);   // the hole's edge is nearest east and west
  assert.ok(Math.abs(C.distToGeomMi(45.36, -91.7, donut) - east) < 0.2, "distance to the inside edge of the ring");
});

test("hail reports: hail only, inside the window, within 10 miles, nearest place and direction", () => {
  const L = C.lsrHail(F.lsr(), F.FIELD.lat, F.FIELD.lon, F.START, F.END);
  assert.equal(L.length, 2, "the wind report, the one 33 miles off and the one before the window are left out");
  assert.deepEqual(L.map((r) => [r.mag, r.dir, Math.round(r.mi)]), [[1.25, "NW", 4], [1, "E", 6]]);
  assert.equal(C.lsrHail(F.lsr(), F.FIELD.lat, F.FIELD.lon, F.START, F.END, 120).length, 3, "the map shows the far one too");
});

test("lightning count: density x 15 minutes x the 8 km cell, and at least when maps are missing", () => {
  const ts = F.lightningTimes().filter((t) => t > F.START && t <= F.END);
  const full = C.lightningStrikes(ts.map((t) => ({ t, v: F.fieldDensity(t) })));
  assert.equal(full.strikes, F.expectedStrikes());
  assert.equal(full.strikes, 34);
  assert.equal(full.read, 96); assert.equal(full.total, 96);
  assert.equal(C.lightningStrikes([{ t: 0, v: 10 }]).strikes, 10, "10 x 1e-3 x 15 x 64 = 9.6, about 10");
  assert.equal(C.featureInfoValue({ features: [{ properties: { GRAY_INDEX: 7.5 } }] }), 7.5);
  assert.equal(C.featureInfoValue({ features: [] }), 0, "no feature at the point: no lightning there");
  assert.equal(C.featureInfoValue({ features: [{ properties: { RED_BAND: 1, GREEN_BAND: 2, BLUE_BAND: 3 } }] }), null, "a colored picture is not a count");
  assert.equal(C.featureInfoValue({ error: "x" }), null);
  assert.equal(C.featureInfoValue({ features: [{ properties: { GRAY_INDEX: -9999 } }] }), 0, "NOAA's no-data value is no lightning");
});

/* ---------- the caption ---------- */
test("the caption reads like a farmer would say it, every number labeled, from the made-up storm", () => {
  const cap = fixtureCaption();
  assert.equal(cap.headline, "Hail estimated at your field Tue 9 to 11 PM; 1.20 in of rain (estimated); about 34 lightning strikes near your field (estimated).");
  const by = Object.fromEntries(cap.lines.map((l) => [l.kind, l]));
  assert.equal(by.hail.tag, "estimate");
  assert.match(by.hail.text, /^Radar estimated hail at your field Tue 9 to 11 PM, up to 1 in\. Radar tends to run large/);
  assert.equal(by.reports.tag, "observed");
  assert.match(by.reports.text, /^2 hail reports within 10 miles, Tue 9:42 to 10:05 PM; largest 1\.25 in, 4 mi NW \(3 NW Chetek\), Tue 9:42 PM\./);
  assert.equal(by.rain.tag, "estimate");
  assert.match(by.rain.text, /^1\.20 in of rain at your field, Tue 7 AM to Wed 7 AM/);
  assert.equal(by.lightning.tag, "estimate");
  assert.match(by.lightning.text, /^About 34 lightning strikes in the 5-mile square your field sits in, most around Tue 10 PM\. Worked from NOAA/);
  for (const l of cap.lines) assert.ok(l.tag === "estimate" || l.tag === "observed", l.text);
  assert.doesNotMatch(JSON.stringify(cap), /\u2014/, "no em dashes");
});

test("near, not over: the caption says so", () => {
  // one band, its south edge 2 miles north of the field
  const lat0 = F.FIELD.lat + 2 / 69.17, box = [[-91.8, lat0], [-91.6, lat0], [-91.6, lat0 + 0.05], [-91.8, lat0 + 0.05], [-91.8, lat0]];
  const doc = { hours: [{ end: "2026-07-15T03:00:00Z", features: [{ properties: { thresh_in: 1.5 }, geometry: { type: "Polygon", coordinates: [box] } }] }] };
  const hh = C.hailHours(doc, F.FIELD.lat, F.FIELD.lon, F.START, F.END);
  const cap = fixtureCaption({ hail: { ok: true, hours: hh } });
  assert.ok(hh.length && hh.every((h) => !h.onField), "nothing over the field");
  assert.match(cap.headline, /^Hail estimated near your field Tue 9 to 10 PM;/);
  assert.equal(Math.round(hh[0].mi), 2);
  assert.match(cap.lines[0].text, /from your field .*but not over the field itself\./);
});

test("missing sources are left out of the caption, never filled in", () => {
  const cap = fixtureCaption({ lightning: { ok: false }, rain: { ok: false } });
  assert.equal(cap.headline, "Hail estimated at your field Tue 9 to 11 PM.");
  assert.ok(!cap.lines.some((l) => l.kind === "lightning" || l.kind === "rain"));
  const part = fixtureCaption({ lightning: { ok: true, strikes: 20, read: 80, total: 96, peak: null } });
  assert.match(part.headline, /at least 20 lightning strikes/);
  assert.match(part.lines.find((l) => l.kind === "lightning").text, /16 of 96 maps could not be read/);
  const none = C.caption({ start: F.START, end: F.END, tz: TZ, hail: { ok: false }, reports: { ok: false }, rain: { ok: false }, lightning: { ok: false } });
  assert.equal(none.headline, "The storm sources did not answer, so there is nothing to say yet about your field.");
  assert.equal(none.lines.length, 0);
  const quiet = C.caption({ start: F.START, end: F.END, tz: TZ, hail: { ok: true, hours: [] }, reports: { ok: true, list: [] }, rain: { ok: false }, lightning: { ok: false } });
  assert.equal(quiet.headline, "Quiet at your field: no radar-estimated hail and no hail reports.");
  assert.match(quiet.lines.find((l) => l.kind === "reports").text, /Quiet can mean nobody called it in/);
  const daily = C.caption({ start: F.START, end: F.END, tz: TZ, hail: { ok: true, hours: [], daily: { maxIn: 1.5, mi: 0, onField: true } }, reports: { ok: false }, rain: { ok: false }, lightning: { ok: false } });
  assert.match(daily.lines[0].text, /the time of day is not known here/);
  // why the clock is missing is said truly: past what the hourly file keeps, or no hours on file at all
  // (Oct 21-23, 2026: hours.json had 0 hours and the live replay said "keeps 2 days")
  const dayOnly = (why) => C.caption({ start: F.START, end: F.END, tz: TZ, hail: { ok: true, why, hours: [], daily: { maxIn: 2, mi: 0, onField: true } }, reports: { ok: false }, rain: { ok: false }, lightning: { ok: false } }).lines[0].text;
  assert.match(dayOnly("old"), /The hour-by-hour file keeps 2 days/);
  assert.doesNotMatch(dayOnly("empty"), /keeps 2 days/);
  assert.match(dayOnly("empty"), /The hour-by-hour estimate is not on file for this window, so the time of day is not known here\./);
});

/* ---------- a source that is down says so ---------- */
test("every degraded source has its own plain sentence", () => {
  const ref = F.END, t = Date.UTC(2026, 6, 14, 19, 10);  // 2:10 PM CDT
  assert.equal(C.sourceLine({ id: "radar", state: "down", since: t }, TZ, ref), "NOAA radar not answering since Tue 2:10 PM.");
  assert.equal(C.sourceLine({ id: "radar", state: "down" }, TZ, ref), "NOAA radar not answering right now.");
  assert.equal(C.sourceLine({ id: "lightning", state: "stale", since: t }, TZ, ref), "NOAA lightning has not updated since Tue 2:10 PM.");
  assert.equal(C.sourceLine({ id: "lightning", state: "short", oldest: t }, TZ, ref), "NOAA lightning only goes back to Tue 2:10 PM; earlier frames have no lightning layer.");
  assert.equal(C.sourceLine({ id: "clouds", state: "down" }, TZ, ref), "NOAA satellite not answering right now.");
  assert.equal(C.sourceLine({ id: "reports", state: "down" }, TZ, ref), "NWS hail reports not answering right now.");
  assert.equal(C.sourceLine({ id: "radar", state: "partial", missing: 3, since: t }, TZ, ref), "NOAA radar: 3 frames did not load, from Tue 2:10 PM.");
  const fr = (sts) => sts.map((st, i) => ({ t: t + i * 15 * MIN, st }));
  assert.deepEqual(C.radarState(fr(["ok", "ok", "bad", "bad"])), { id: "radar", state: "down", since: t + 15 * MIN });
  assert.deepEqual(C.radarState(fr(["ok", "bad", "ok", "wait"])), { id: "radar", state: "partial", missing: 1, since: t + 15 * MIN });
  assert.deepEqual(C.radarState(fr(["bad", "bad"])), { id: "radar", state: "down", since: null });
  assert.deepEqual(C.radarState(fr(["ok", "wait"])), { id: "radar", state: "ok", newest: t });
});

/* ---------- credits ---------- */
test("every layer and source has an on-screen credit; the page draws them all", () => {
  for (const k of C.LAYERS.concat(["rain", "map"])) {
    const c = C.CREDITS[k];
    assert.ok(c && c.name && c.what && c.url, "credit for " + k);
  }
  assert.match(C.CREDITS.radar.what, /Iowa Environmental Mesonet/);
  assert.match(C.CREDITS.lightning.what, /nowCOAST.*Vaisala/);
  assert.match(C.CREDITS.reports.what, /National Weather Service/);
  assert.match(C.CREDITS.swaths.what, /MRMS MESH/);
  const ui = readFileSync(ROOT + "components/storm-replay.js", "utf8");
  assert.match(ui, /\['radar', 'lightning', 'clouds', 'swaths', 'reports', 'rain', 'map'\]\.map\(function \(k\) \{\s*var c = C\.CREDITS\[k\]/);
});

/* ---------- page weight ---------- */
test("the replay's code loads only when a reader opens it", () => {
  for (const page of ["hail-map.html", "rain-radar.html"]) {
    const html = readFileSync(ROOT + page, "utf8");
    assert.doesNotMatch(html, /<script[^>]+storm-replay/, page + " does not load the replay up front");
    assert.match(html, /ld\('\/components\/storm-replay-core\.js\?v=2'\)/, page + " loads the core on open");
    assert.match(html, /ld\('\/components\/storm-replay\.js\?v=2'\)/, page);
    assert.ok(html.includes("[?&]sr=1(&|$)"), page + " opens a shared replay");
  }
  assert.match(readFileSync(ROOT + "hail-map.html", "utf8"), /id="hm-replay"/);
  assert.match(readFileSync(ROOT + "rain-radar.html", "utf8"), /id="rr-replay"/);
});

test("no em dashes and no AI vendor names in the served replay files", () => {
  for (const f of ["components/storm-replay.js", "components/storm-replay-core.js"]) {
    const s = readFileSync(ROOT + f, "utf8");
    assert.doesNotMatch(s, /\u2014|&mdash;/, f);
    assert.doesNotMatch(s, /\b(Claude|Anthropic|OpenAI|ChatGPT|GPT-\d|Gemini)\b/, f);
  }
});
