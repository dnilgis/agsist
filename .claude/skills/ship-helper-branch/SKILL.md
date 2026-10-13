---
name: ship-helper-branch
description: Use when merging a helper's fx/* branch (or any finished work) into main on agsist. Covers the merge, every check that must pass, generated-page rules, cache bumps and the push to main plus the working branch.
---
# Ship a helper branch to main

1. `cd /home/user/agsist && git pull --no-rebase origin main` (never rebase, never stash).
2. `git diff --stat HEAD...fx/<name>`. Read the diff of hand-written files. Generated pages (state, county, town sets, prf.html) are never hand-edited; if a conflict lands in generated output, take main's and re-run its generator.
3. `git merge --no-edit fx/<name>`.
4. Checks, all must pass:
   - `node --test` (0 fail)
   - `python3 scripts/check_site_budget.py` (CLAUDE.md: 1 GB site, 150 KB per generated page)
   - `python3 scripts/build_feeds.py && python3 scripts/test_feeds.py`. If only data/feeds.json changed, commit it ("Rebuild the feed manifest").
   - If the worker changed: `node scripts/test_form_worker.mjs`.
   - If PRF files changed: see the prf-page-regen skill.
5. If a component JS changed, bump its `?v=` everywhere it loads, and `CACHE_VERSION` in sw.js once per batch.
6. Commit as `git -c user.name=dnilgis -c user.email=dnilgis@gmail.com commit` with a plain message: no AI mentions, no Co-Authored-By.
7. Push: `git push origin HEAD:main` (on rejection, pull --no-rebase and retry; bots commit data every few minutes), then `git push -f origin HEAD:claude/<session-branch>` so the working branch mirrors main.
8. Tell Sig in plain words what is now live and what it changes for a reader.
