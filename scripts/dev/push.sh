#!/bin/bash
# Push HEAD to main (fetch + merge retry), then mirror it to the session's working branch.
# Usage: scripts/dev/push.sh <working-branch>     Run scripts/dev/checks.sh first; push only on FAILS=0.
cd "$(git rev-parse --show-toplevel)" || exit 1
BR="${1:-}"
# Oct 18, 2026: a helper worktree shipped with -f to the working branch and dropped three commits that
# lived only there. Bring the working branch in FIRST, so nothing on it can be lost, then push.
if [ -n "$BR" ] && git fetch -q origin "$BR" 2>/dev/null; then
  git merge -q --no-edit "origin/$BR" 2>&1 | grep CONFLICT && { echo "CONFLICT with origin/$BR"; exit 1; }
fi
for i in 1 2 3 4 5; do
  git push -q origin HEAD:main 2>/dev/null
  git fetch -q origin main
  [ "$(git rev-parse origin/main)" = "$(git rev-parse HEAD)" ] && break
  git merge -q --no-edit origin/main 2>&1 | grep CONFLICT && { echo CONFLICT; exit 1; }
  sleep $((2**i))
done
# never force: HEAD now contains the working branch, so a plain push always fast-forwards
[ -n "$BR" ] && { git push -q origin HEAD:"$BR" || { echo "working branch push refused: $BR moved; rerun"; exit 1; }; }
echo main=$(git rev-parse --short origin/main) head=$(git rev-parse --short HEAD)
