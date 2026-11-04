/* Share images on dnilgis/agsist-data (Nov 4, 2026; growth plan phase 1, scripts/share_host.py).
 *
 * The Atlas cards (farmland-atlas/og/) and the Daily cards (data/social/) move to the public repo
 * dnilgis/agsist-data, served from dnilgis.github.io/agsist-data/ at the same paths. A page must never point
 * at an image that is not there, so the order is: copy, check the copies answer, then flip (the seed job
 * lists the folder in data/share-host.json and rewrites the pages in the same commit).
 *
 *   1. the guard: no committed page names a listed folder on agsist.com, and no builder spells either
 *      folder's agsist.com URL (they go through share_host.url()), checked on the real tree;
 *   2. share_host.py's own selftest (mark, flip, check, verify, the daily cron-health row) on fixtures;
 *   3. the producers copy before they commit, the Daily's copy can never hold the briefing, and the seed
 *      job checks the copies before it flips anything;
 *   4. the builders read the host: the Atlas head, the Daily's og:image and the home page card.
 *
 *   node --test test/share-host.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 300000 });
const step = (wf, name) => {
  const s = read(join(".github/workflows", wf));
  const i = s.indexOf(`- name: ${name}`);
  assert.ok(i > 0, `${wf} has the step "${name}"`);
  const j = s.indexOf("\n      - ", i + 10);
  return { text: s.slice(i, j < 0 ? undefined : j), at: i, all: s };
};

test("guard: no page names a moved folder on agsist.com, no builder hard-codes one", () => {
  const out = py(["scripts/share_host.py", "check"]);
  assert.match(out, /share_host check: OK/);
});

test("share_host.py selftest (mark, flip, check, verify, the daily row)", () => {
  const out = py(["scripts/share_host.py", "--selftest"]);
  assert.match(out, /share_host selftest: OK/);
});

test("data/share-host.json names the host and lists only known folders", () => {
  const doc = JSON.parse(read("data/share-host.json"));
  assert.equal(doc.host, "https://dnilgis.github.io/agsist-data");
  for (const f of Object.keys(doc.folders || {})) assert.ok(["farmland-atlas/og", "data/social"].includes(f), f);
});

test("the Atlas copies its cards to agsist-data after drawing them and before its commit", () => {
  const draw = step("farmland-atlas-pages.yml", "Draw share images");
  const copy = step("farmland-atlas-pages.yml", "Copy share images to agsist-data");
  const commit = step("farmland-atlas-pages.yml", "Commit if changed");
  assert.ok(draw.at < copy.at && copy.at < commit.at, "draw, copy, commit");
  assert.match(copy.text, /bash scripts\/agsist_data\.sh sync --soft farmland-atlas\/og/);
  assert.match(copy.text, /AGSIST_DATA_TOKEN: \$\{\{ secrets\.AGSIST_DATA_TOKEN \}\}/);
  // after the flip a failed copy must stop the commit: no continue-on-error here
  assert.doesNotMatch(copy.text, /continue-on-error/);
});

test("the Daily copies its card before its commit and can never be held by it", () => {
  const card = step("daily.yml", "Build social card");
  const copy = step("daily.yml", "Copy social card to agsist-data");
  const commit = step("daily.yml", "Commit and push");
  assert.ok(card.at < copy.at && copy.at < commit.at, "card, copy, commit");
  assert.match(copy.text, /continue-on-error: true/);
  assert.match(copy.text, /timeout-minutes: [1-5]\b/);
  assert.match(copy.text, /bash scripts\/agsist_data\.sh sync --soft data\/social/);
  // a bad token cannot eat the 4 minutes; then a best-effort wait for today's card on agsist-data
  assert.match(copy.text, /AGSIST_DATA_TRIES: "2"/);
  assert.match(copy.text, /python3 scripts\/share_host\.py wait index\.html --wait (\d+)/);
  assert.ok(+copy.text.match(/--wait (\d+)/)[1] <= 180, "the wait fits inside the step's 4 minutes");
});

test("the seed's flip waits for any Daily run (API, not a shared group) and never runs in the Daily's window", () => {
  const wf = read(".github/workflows/agsist-data-seed.yml");
  const flipJob = wf.slice(wf.indexOf("\n  flip:\n"));
  assert.ok(flipJob.length > 10, "a separate flip job");
  // never the Daily's concurrency group: GitHub cancels all but one pending run in a group
  assert.doesNotMatch(wf, /daily-briefing/, "no shared group with the Daily");
  const wait = flipJob.indexOf("- name: Wait for any Daily run to finish");
  const again = flipJob.indexOf("- name: Still not in the Daily's window");
  const flip = flipJob.indexOf("share_host.py --root");
  assert.ok(wait > 0 && wait < again && again < flip, "wait for the Daily, re-check the time, then flip");
  const waitStep = flipJob.slice(wait, again);
  assert.match(waitStep, /actions\/workflows\/daily\.yml\/runs\?status=\$st/);
  assert.match(waitStep, /for st in queued in_progress/);
  assert.match(waitStep, /sleep 30/);
  assert.match(waitStep, /seq 1 61/, "30 minutes of 30 s checks");
  assert.match(waitStep, /exit 1/, "a Daily still running stops the flip");
  assert.match(flipJob, /actions: read/);
  const windows = wf.match(/-ge 1000 \] && \[ "\$now" -lt 1430 \]/g) || [];
  assert.equal(windows.length, 3, "the seed, the flip and the re-check after the wait refuse 10:00 to 14:30 UTC");
  assert.match(wf, /any_time:/);
});

test("the seed job copies, checks the copies, then flips; by hand only, never forced", () => {
  const wf = read(".github/workflows/agsist-data-seed.yml");
  assert.match(wf, /\non:\n  workflow_dispatch:/);
  assert.doesNotMatch(wf, /schedule:|cron:/);
  const copy = wf.indexOf("scripts/agsist_data.sh sync");
  const verify = wf.indexOf("scripts/share_host.py verify");
  const mark = wf.indexOf("share_host.py --root \"$W\" mark");
  const flip = wf.indexOf("share_host.py --root \"$W\" flip");
  assert.ok(copy > 0 && copy < verify && verify < mark && mark < flip, "copy, verify, mark, flip");
  assert.doesNotMatch(wf, /push[^\n]*(--force|-f\b)/);
  assert.doesNotMatch(read("scripts/agsist_data.sh"), /push[^\n]*(--force|-f\b)/);
});

test("the token goes in a header, never in a URL or a file", () => {
  const s = read("scripts/agsist_data.sh");
  assert.match(s, /GIT_CONFIG_VALUE_0="AUTHORIZATION: basic \$auth"/);
  assert.match(s, /::add-mask::/);
  assert.doesNotMatch(s, /x-access-token:[^%]*@github\.com/);
  assert.doesNotMatch(s, /git config [^\n]*extraheader/);
});

test("the builders read the host from share_host.py", () => {
  assert.match(read("scripts/build_atlas_pages.py"), /img_url = SH\.url\(image\)/);
  assert.match(read("scripts/generate_daily.py"), /OG_IMAGE_BASE = _share_host\.url\("data\/social\/card-"\)/);
  assert.match(read("scripts/build_social_card.py"), /url = share_host\.url\(/);
  const day = ["2030", "01", "02"].join("-");  // an inline fixture day, not live data
  const out = py(["-c", [
    "import sys; sys.path.insert(0, 'scripts')",
    "import share_host as S, generate_daily as G",
    `print(G.og_image_for('${day}'))`,
    "print(S.url('/farmland-atlas/og/hub.png?v=1'))",
    "print(S.url('/img/og/agsist.jpg'))",
  ].join("\n")]).trim().split("\n");
  const seeded = Object.keys(JSON.parse(read("data/share-host.json")).folders || {});
  const host = (f) => (seeded.includes(f) ? "https://dnilgis.github.io/agsist-data" : "https://agsist.com");
  assert.equal(out[0], `${host("data/social")}/data/social/card-${day}.jpg`);
  assert.equal(out[1], `${host("farmland-atlas/og")}/farmland-atlas/og/hub.png?v=1`);
  assert.equal(out[2], "https://agsist.com/img/og/agsist.jpg", "other images stay on agsist.com");
});

test("the copy script exists and is the one the workflows call", () => {
  assert.ok(existsSync(join(ROOT, "scripts/agsist_data.sh")));
  assert.match(read("scripts/agsist_data.sh"), /git -C "\$dir\/r" push -q origin HEAD:main/);
});
