---
name: subscriber-count
description: Use when Sig asks about email subscribers or signups. Counts only; no address ever goes into chat, logs or files.
---
# Subscriber count (counts only)

1. Fresh count: `gh workflow run sponsor-report.yml -R dnilgis/agsist --ref main`, wait for it to finish (`gh run watch <id>`), then `git pull` in /home/user/agsist.
2. Read `data/audience.json` -> `email.subscribers` and `email.asOf`. Compare with the last number reported in the conversation or handoff.
3. The per-source breakdown (scripts/build_signups.py) is written only inside the workflow and is never published; report it only if it appears as counts.
4. Never print, store or paste an email address. Don't ask Sig for the list token.
