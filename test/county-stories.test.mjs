/* The written story on each county rain page (scripts/county_stories.py).
 *
 * The Python selftest builds county pages from the saved ACIS answers
 * (test/fixtures/rain) and checks: the facts sent to the model are the numbers
 * the page prints; the validator passes a true story and rejects planted wrong
 * amounts, dates, months, percents, directions, em dashes, banned and number
 * words; a story shows only when its facts hash matches the page's facts now.
 * Here we also hold the shipped stories (data/rain/stories, written only from a
 * real batch) to the same rules: each passes the validator against its own
 * stored facts, and only fresh, same-station stories show.
 *
 *   node --test test/county-stories.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("facts match the page, the validator catches planted errors, dated stories show only fresh and on the same station", () => {
  assert.match(py(["scripts/county_stories.py", "selftest"]), /county stories selftest: ok/);
});

test("the API job builds story requests on Opus 5.5 and stays under its cap", () => {
  assert.match(py(["scripts/api_jobs.py", "selftest"]), /selftest ok/);
  const src = readFileSync(ROOT + "scripts/api_jobs.py", "utf8");
  assert.match(src, /STORY_MODEL = "claude-opus-5-5"/);
  assert.match(src, /STORY_CAP = (\d+(\.\d+)?)/);
  assert.ok(Number(src.match(/STORY_CAP = (\d+(\.\d+)?)/)[1]) <= 50, "story cap at most $50");
});

test("the prompt and the code carry no em dash; the workflow builds the input and checks the stories", () => {
  const src = readFileSync(ROOT + "scripts/county_stories.py", "utf8");
  assert.ok(!src.includes("\u2014") && !src.includes("\u2013"), "no literal em or en dash in the source");
  const sys = src.split('SYSTEM = """')[1].split('"""')[0];
  assert.ok(!sys.includes("\u2014") && !sys.includes("!"), "prompt: no em dash, no exclamation");
  assert.match(sys, /Use only those facts/);
  const wf = readFileSync(ROOT + ".github/workflows/api-jobs.yml", "utf8");
  assert.match(wf, /county_stories\.py bundle/);
  assert.match(wf, /county_stories\.py collect/);
  assert.doesNotMatch(wf, /schedule:/, "dispatch only, no cron");
});

test("shipped stories: each one passes the validator, and a page shows it only on a facts match", () => {
  const dir = ROOT + "data/rain/stories";
  if (!existsSync(dir)) return;   // none until the first batch comes back
  const out = py(["-c", `
import sys, json, os
sys.path.insert(0, "scripts")
import county_stories as CS
data = os.path.join(CS.ROOT, "data", "rain")
S = CS.load_stories(data)
bad = []
shown = 0
for st, d in CS._B().load(data).items():
    for fips, c in d["counties"].items():
        e = S.get(st, {}).get(fips)
        if not e:
            continue
        for ch in ("\\u2014", "\\u2013", "!"):
            if ch in e.get("story", ""):
                bad.append((fips, ch))
        if not isinstance(e.get("facts"), dict) or CS.validate(e.get("story", ""), e["facts"]):
            bad.append((fips, "fails its own facts"))
        # the build checks a dated story against today's facts too (2026-10-23): a sentence no longer true comes off
        shown += CS.story_for(e, dict(CS.page_now(c, d), facts=CS.facts(c, d, st))) is not None
print(json.dumps({"bad": bad, "shown": shown}))
`]);
  const r = JSON.parse(out);
  assert.deepEqual(r.bad, []);
  // every page that prints a story prints one that matches its facts now (build --check covers the rest)
  let pages = 0;
  for (const st of readdirSync(ROOT + "rain", { withFileTypes: true })) {
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(ROOT + "rain/" + st.name)) {
      const h = readFileSync(ROOT + "rain/" + st.name + "/" + f, "utf8");
      if (h.includes('class="rc-story"')) {
        pages++;
        assert.ok(!/rc-story">[^<]*\u2014/.test(h), f);
      }
    }
  }
  assert.equal(pages, r.shown, "pages with a story = stored stories that are fresh and on the same station");
});
