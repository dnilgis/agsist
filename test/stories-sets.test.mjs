/* The dated lead paragraphs on the PRF county, Farmland Atlas county, town cash
 * bid and co-op company pages (scripts/stories_core.py and its sets:
 * stories_prf.py, stories_atlas.py, stories_bids.py). The county rain stories
 * (test/county-stories.test.mjs) were first; these reuse the same rules.
 *
 * The Python selftests check: the facts sent to the model are the figures each
 * real page prints (PRF: all 3,070 committed county pages; Atlas: every county
 * page); the validator passes true stories said several ways and rejects
 * planted errors (wrong amounts, a figure on the wrong year or pair of months,
 * the wrong way, sales words, agents, names the facts do not give, prices on
 * the bid pages, forecasts, number words, em dashes); a story prints only when
 * the facts the page states now hash to the story's own, and drops off when a
 * figure moves or it ages out.
 *
 *   node --test test/stories-sets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const py = (args, env = {}) =>
  execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, maxBuffer: 64 << 20 });

test("PRF: facts match every county page, planted errors are caught, the story shows only on a facts match", () => {
  assert.match(py(["scripts/stories_core.py", "selftest", "prf"]), /prf stories selftest: ok/);
});

test("Farmland Atlas: facts match the county pages, no names, flagged land values never spoken of", () => {
  assert.match(py(["scripts/stories_core.py", "selftest", "atlas"]), /atlas stories selftest: ok/);
});

test("town and company: no price ever, elevators and crops as the page names them, a moved fact takes the story off", () => {
  assert.match(py(["scripts/stories_core.py", "selftest", "town"]), /town and company stories selftest: ok/);
});

test("the API job builds one request per page for each set, on Opus 5.5, under the cap", () => {
  assert.match(py(["scripts/api_jobs.py", "selftest"]), /selftest ok/);
  const src = read("scripts/api_jobs.py");
  assert.match(src, /SET_STORY_MAX_TOKENS = \d+/);
  assert.match(src, /"p": "story", "f": "story", "t": "story", "o": "story"/);
});

test("prompts and code carry no em dash; PRF stays neutral; the bid pages never get a price", () => {
  for (const f of ["scripts/stories_core.py", "scripts/stories_prf.py", "scripts/stories_atlas.py", "scripts/stories_bids.py"]) {
    const s = read(f);
    assert.ok(!s.includes("—") && !s.includes("–"), `${f}: no literal em or en dash`);
  }
  const prf = read("scripts/stories_prf.py");
  const sys = prf.split('SYSTEM = """')[1].split('"""')[0];
  assert.match(sys, /Use only those facts/);
  assert.match(sys, /No buying, signing up, choosing months or coverage, no agents/);
  for (const w of ['"agent"', '"buy"', '"payback"', '"return"', '"you"', '"recommend"']) assert.ok(prf.includes(w), `PRF bans ${w}`);
  assert.doesNotMatch(prf.split("def county_facts")[1].split("def card_grid")[0], /payback_mid_90|example/, "no payback or priced example in the PRF facts");
  const bids = read("scripts/stories_bids.py");
  assert.match(bids, /a price or a basis amount/);
  const atlas = read("scripts/stories_atlas.py");
  for (const w of ['"buyer"', '"seller"', '"owner"', '"sale"']) assert.ok(atlas.includes(w), `Atlas bans ${w}`);
});

test("the builders print the story where it belongs and only through the set's own gate", () => {
  const prfB = read("scripts/build_prf_counties.py");
  assert.match(prfB, /SP\.story_html\(STORIES, st\["st"\], fips, SP\.county_facts\(/);
  /* Sig, Oct 20: the county page's first screen leads with the priced example; the story heads the record section */
  assert.ok(prfB.indexOf('<h2 id="record">') < prfB.indexOf('{ctx.get("story", "")}'), "PRF: at the head of the record section");
  assert.ok(prfB.indexOf('class="prf-lede"') < prfB.indexOf("{exh}") && prfB.indexOf("{exh}") < prfB.indexOf('{ctx.get("story", "")}'), "PRF: the example comes first");
  const at = read("scripts/build_atlas_pages.py");
  assert.match(at, /SA\.story_html\(W\.stories, W, f, d\)/);
  assert.match(at, /\{story_html\}\{warn\}<div class="two">/);
  const cb = read("scripts/build_cash_bid_pages.py");
  assert.match(cb, /\{answer_html\}\n  \{story_html\}\{intro\}/);
  assert.match(cb, /STORY_FACTS_OUT/);
  const co = read("scripts/build_company_pages.py");
  assert.match(co, /SBX\.COMPANY\.story_html\(/);
  const wf = read(".github/workflows/api-jobs.yml");
  for (const b of ["prf-stories", "atlas-stories", "town-stories", "company-stories"]) assert.ok(wf.includes(b), `workflow builds ${b}`);
  assert.match(wf, /stories_core\.py collect "\$SET"/);
  assert.doesNotMatch(wf, /schedule:/, "dispatch only");
  // the stores sit outside folders a data workflow rebuilds from scratch
  assert.match(read("scripts/stories_prf.py"), /STORE = os\.path\.join\("data", "prf-stories"\)/);
  assert.match(read(".github/workflows/prf.yml"), /rm -rf data\/prf /, "prf.yml still wipes data/prf, so the store stays out of it");
});

test("shipped stories: every page that prints one prints a story that passes against its facts now", () => {
  for (const [set, dir, pages, cls] of [["prf", "data/prf-stories", "prf", "prf-story"], ["atlas", "data/atlas-stories", "farmland-atlas", "ap-story"]]) {
    if (!existsSync(ROOT + dir)) continue;   // none until the first batch comes back
    const out = py(["scripts/stories_core.py", "stale", set]);
    const m = out.match(/(\d+) stored \w+ stories, (\d+) still show/);
    assert.ok(m, out);
    let n = 0;
    for (const st of readdirSync(ROOT + pages, { withFileTypes: true })) {
      if (!st.isDirectory()) continue;
      for (const f of readdirSync(ROOT + pages + "/" + st.name)) {
        if (!f.endsWith(".html")) continue;
        const h = readFileSync(ROOT + pages + "/" + st.name + "/" + f, "utf8");
        if (h.includes(`class="${set === "prf" ? "prf-lede " : "sub "}${cls}"`)) {
          n++;
          assert.ok(!/story">[^<]*—/.test(h), f);
        }
      }
    }
    assert.equal(n, Number(m[2]), `${set}: pages with a story = stored stories that still match`);
  }
});
