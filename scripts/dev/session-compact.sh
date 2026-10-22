#!/bin/bash
# SessionStart hook, matcher "compact" (.claude/settings.json): after a compaction, put back
# the head (about 4 KB) of the "Now" section of the private notes' HANDOFF.md, and the open
# fx/* branches, so the session does not lose where things stand. Its stdout goes into context.
# FEEDBAG_DIR: the private repo's clone (default /home/user/agsistretired). Always exits 0.
timeout 5 cat >/dev/null 2>&1   # the hook's JSON; nothing in it is needed
FB="${FEEDBAG_DIR:-/home/user/agsistretired}"
H="$FB/notes/HANDOFF.md"
LIMIT="${COMPACT_HEAD_BYTES:-4096}"
if [ -f "$H" ]; then
  echo "From the private notes ($H), the head of the \"Now\" section (read the rest, BUILD-RULES.md and STANDING-DECISIONS.md before building):"
  awk '/^## Now/{on=1; print; next} on && /^## /{exit} on' "$H" | head -c "$LIMIT"
  echo
else
  echo "Private notes not cloned here: add dnilgis/feedbag to the session and read notes/HANDOFF.md (section \"Now\"), notes/BUILD-RULES.md and notes/STANDING-DECISIONS.md before building."
fi
R=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --show-toplevel 2>/dev/null)
if [ -n "$R" ]; then
  b=$(git -C "$R" for-each-ref --no-merged=origin/main --sort=-committerdate --count=40 --format='%(refname:lstrip=3)  %(committerdate:short)  %(subject)' refs/remotes/origin/fx/ 2>/dev/null | cut -c1-140)
  n=$(git -C "$R" for-each-ref --no-merged=origin/main --format=x refs/remotes/origin/fx/ 2>/dev/null | wc -l)
  echo "Open fx/* branches on origin (not merged into main: $n, newest first, as of the last fetch; at most 40 shown):"
  [ -n "$b" ] && printf '%s\n' "$b" | sed 's/^/  /' || echo "  none"
fi
exit 0
