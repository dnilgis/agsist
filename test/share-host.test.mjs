/* Share images on dnilgis/agsist-data (Nov 4, 2026; growth plan phase 1, scripts/share_host.py).
 *
 * The Atlas cards (farmland-atlas/og/) and the Daily cards (data/social/) moved to the public repo
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

test("share_host.py selftest (mark, flip, check, verify, wait, the daily row)", () => {
  const out = py(["scripts/share_host.py", "--selftest"]);
  assert.match(out, /share_host selftest: OK/);
});

test("data/share-host.json names the host and lists only known folders", () => {
  const doc = JSON.parse(read("data/share-host.json"));
  assert.equal(doc.host, "https://dnilgis.github.io/agsist-data");
  for (const f of Object.keys(doc.folders || {})) assert.ok(["farmland-atlas/og", "data/social"].includes(f), f);
});

test("both folders are served from agsist-data and none of their files is kept here", () => {
  const doc = JSON.parse(read("data/share-host.json"));
  assert.deepEqual(Object.keys(doc.folders).sort(), ["data/social", "farmland-atlas/og"]);
  const tracked = execFileSync("git", ["ls-files", "--", "farmland-atlas/og", "data/social"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(tracked.trim(), "", "no share image is committed here");
  const ign = read(".gitignore");
  assert.match(ign, /^\/farmland-atlas\/og\/$/m);
  assert.match(ign, /^\/data\/social\/$/m);
  assert.ok(!existsSync(join(ROOT, ".github/workflows/agsist-data-seed.yml")), "the one-time seed job is gone");
});

test("the Atlas draws its cards into an agsist-data checkout and pushes them before its commit", () => {
  const co = step("farmland-atlas-pages.yml", "Check out the share images");
  const draw = step("farmland-atlas-pages.yml", "Draw share images");
  const push = step("farmland-atlas-pages.yml", "Push share images to agsist-data");
  const commit = step("farmland-atlas-pages.yml", "Commit if changed");
  assert.ok(co.at < draw.at && draw.at < push.at && push.at < commit.at, "checkout, draw, push, commit");
  assert.match(co.text, /bash scripts\/agsist_data\.sh checkout "\$RUNNER_TEMP\/agsist-data"/);
  assert.match(draw.text, /build_atlas_cards\.py --out "\$RUNNER_TEMP\/agsist-data\/farmland-atlas\/og"/);
  assert.match(push.text, /agsist_data\.sh sync --from "\$RUNNER_TEMP\/agsist-data" farmland-atlas\/og/);
  for (const x of [co, draw, push]) {
    assert.doesNotMatch(x.text, /continue-on-error|--soft/, "a failure stops the run before the commit");
  }
  assert.match(co.text + push.text, /AGSIST_DATA_TOKEN: \$\{\{ secrets\.AGSIST_DATA_TOKEN \}\}/);
  assert.doesNotMatch(read(".github/workflows/farmland-atlas-pages.yml"), /atlas-cards/);
});

test("the card builder never writes into this repository", () => {
  let err = null;
  try { py(["scripts/build_atlas_cards.py"]); } catch (e) { err = e; }
  assert.ok(err && err.status === 2, "no --out: refuses");
  assert.match(String(err.stderr), /--out <agsist-data checkout>\/farmland-atlas\/og/);
});

test("the Daily draws its card outside the checkout and can never be held by agsist-data", () => {
  const card = step("daily.yml", "Build social card");
  const copy = step("daily.yml", "Copy social card to agsist-data");
  const commit = step("daily.yml", "Commit and push");
  assert.ok(card.at < copy.at && copy.at < commit.at, "card, copy, commit");
  assert.match(card.text, /continue-on-error: true/);
  assert.match(card.text, /SOCIAL_CARD_DIR: \$\{\{ runner\.temp \}\}\/social\/data\/social/);
  assert.match(copy.text, /continue-on-error: true/);
  assert.match(copy.text, /timeout-minutes: [1-5]\b/);
  // adds today's card there, never mirrors (a run holds one card, not the archive)
  assert.match(copy.text, /bash scripts\/agsist_data\.sh sync --keep --from "\$RUNNER_TEMP\/social" data\/social/);
  assert.match(copy.text, /AGSIST_DATA_TRIES: "2"/);
  assert.match(copy.text, /python3 scripts\/share_host\.py wait index\.html --wait (\d+)/);
  assert.ok(+copy.text.match(/--wait (\d+)/)[1] <= 180, "the wait fits inside the step's 4 minutes");
  assert.doesNotMatch(commit.text, /data\/social/, "the Daily commits no card");
  assert.match(read("scripts/build_social_card.py"), /OUT_DIR = os\.environ\.get\("SOCIAL_CARD_DIR"\)/);
});

test("an archive rebuild keeps each issue's own card (the cards are not on this disk)", () => {
  const out = py(["-c", [
    "import sys, os, re, json; sys.path.insert(0, 'scripts')",
    "import generate_daily as G",
    "res = {'card': 0, 'plain': 0, 'moved': []}",
    "for f in sorted(os.listdir('daily')):",
    "    m = re.match(r'(\\d{4}-\\d\\d-\\d\\d)\\.html$', f)",
    "    if not m: continue",
    "    u = G.og_image_for(m.group(1), require_file=True)",
    "    res['card' if '/card-' in u else 'plain'] += 1",
    "    if u not in open('daily/' + f, encoding='utf-8').read(): res['moved'].append(m.group(1))",
    "print(json.dumps(res))",
  ].join("\n")]);
  const r = JSON.parse(out);
  assert.deepEqual(r.moved, [], "every issue keeps the image it carries");
  assert.ok(r.card >= 109, `issues with their own card: ${r.card}`);
  assert.ok(r.plain > 0, "issues before the cards keep the plain card");
});

test("agsist_data.sh never forces a push and refuses to empty a folder", () => {
  const s = read("scripts/agsist_data.sh");
  assert.doesNotMatch(s, /push[^\n]*(--force|-f\b)/);
  assert.match(s, /refusing to remove more than half/);
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
