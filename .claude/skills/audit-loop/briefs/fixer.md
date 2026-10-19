# Fixer brief template (one per area; write to <scratchpad>/briefs/<task>.md, launch with
# "Read common.md then <task>.md; check git log/status in the worktree first")

Helper <X>: <area> (worktree /tmp/x/<wt>, branch fx/<name>)
Confirmed by audit + adversary (<date>). Owned files: <list>. Do NOT touch: <other helpers' areas>.
Items: <numbered, each with the confirmed example and the minimal fix the adversary approved>.
Tests: a regression test per item from the REAL case (copy a minimal fixture of the real data into test/fixtures/<area>/);
existing tests pass unchanged (a pinned version or a string Sig changed may be updated, said in the commit).
Generated pages: change the builder; rebuild locally to diff counts (pages changed, none dropped unexpectedly).
Bump ?v= and sw.js CACHE_VERSION for changed components (HANDOFF "How we ship").
Run scripts/dev/checks.sh with TMPDIR=/tmp/x/h<letter>; rerun known-flaky browser tests alone and list them.
Commit after each item as dnilgis. Never push or merge. Write /tmp/x/<wt>/HELPER-DONE.md (not committed): before/after
for the real examples, test results, anything Sig must decide.
