# Common rules for every helper
- Before pushing: scripts/dev/checks.sh must print FAILS=0 (it runs everything below).
- Repo (the agsist checkout) = agsist.com, static GitHub Pages. Read CLAUDE.md (150 KB cap per generated page, 1 GB site; scripts/check_site_budget.py).
- Work ONLY in your named worktree under <scratchpad>/wt/. Start with `git fetch origin main && git merge origin/main` there.
- Commit OFTEN (a cutoff can come any time) with `git -c user.name=dnilgis -c user.email=dnilgis@gmail.com commit`; plain messages, no AI mentions, no Co-Authored-By. Do NOT push or merge to main.
- Never weaken a test. Never run any script with --help. No git stash. Never pkill by pattern (serve with python http.server on a free port; kill by PID).
- Copy: no em dashes, plain farm words, nothing AI-sounding, no store names. Honest numbers only: no look-ahead, withhold when unsure.
- Playwright: executablePath /opt/pw-browsers/chromium. LOOK at every screenshot you take.
- Outbound network goes through a proxy (/root/.ccr/README.md); data.rcc-acis.org is blocked here.
- Checks before reporting: node --test; python3 scripts/check_site_budget.py; python3 scripts/build_feeds.py && python3 scripts/test_feeds.py.
- Before pushing agsist, also run the feeds-guard steps (test_feeds.py, network-checks.mjs, delivery-checks.mjs, market-clock-checks.mjs, network-safety-checks.mjs, homepage-bids-checks.mjs, test_send_loops.py, test_basis_states.py) and build_llms_txt.py --check (add any new sitemap page to scripts/build_llms_txt.py PAGES).
## Primary sources (references branch)
The sandbox cannot open USDA, RMA, extension or vendor sites. GitHub Actions can, and keeps copies on the
`references` branch (never deployed). Before you state a fact from a search snippet, read the source:
- List: `git fetch origin references && git show origin/references:index.json` (id, url, status, fetched_utc).
- Read one: `git show origin/references:refs/<id>.txt` (PDF text is `pdftotext -layout`; first lines give url and fetch date).
- Original file: `git show origin/references:refs/<id>.pdf > /tmp/x.pdf` (or `.html`).
- A row with status `failed` means that copy is old or missing; say so, do not treat a snippet as checked.
- Need a source that is not there? Add {id, url, title, why, kind: pdf|html} to `references/sources.json` on your branch,
  run `python3 scripts/fetch_refs.py --check`, and ask the lead to dispatch
  refs.yml (REST: gh api -X POST repos/dnilgis/agsist/actions/workflows/refs.yml/dispatches -f ref=main -F "inputs[ids]=<id>") after it merges. Cite the URL on the page, not the branch.
