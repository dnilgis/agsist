---
name: run-helpers
description: Use when starting, briefing or restarting background helper agents on agsist or bids work. Briefs live in files so a cut-off helper can be replaced in seconds.
---
# Run helpers that survive cutoffs

- Write each brief to `<scratchpad>/briefs/<task>.md` and keep house rules in `briefs/common.md`. Launch with a short prompt: "Read common.md then <task>.md; check git log/status in the worktree first."
- Each helper works in its own worktree: `git worktree add <scratchpad>/wt/<name> -b fx/<name> origin/main`. Helpers never push or merge; the main session ships (ship-helper-branch skill).
- Tell helpers to commit often. Usage limits and interruptions kill them mid-task.
- An interrupted tool call in the main session stops background helpers, and they can't be resumed after that. Relaunch from the brief file. After a usage-limit reset, a SendMessage resumes a helper that was only rate-limited.
- Check a helper's progress via worktree git log and file mtimes, never by reading its transcript file.
- Parallelize independent work in one message. Don't give two helpers the same files.
- Sig's preference: keep working when he drops in a thought; stop only when he asks.
- Tell Sig honestly what is running. Simulated buyers or panels are labeled simulated.
