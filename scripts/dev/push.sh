#!/bin/bash
# Push HEAD to main (fetch + merge retry), then mirror it to the session's working branch.
# Usage: scripts/dev/push.sh <working-branch>     Run scripts/dev/checks.sh first; push only on FAILS=0.
cd "$(git rev-parse --show-toplevel)" || exit 1
BR="${1:-}"
for i in 1 2 3 4 5; do
  git push -q origin HEAD:main 2>/dev/null
  git fetch -q origin main
  [ "$(git rev-parse origin/main)" = "$(git rev-parse HEAD)" ] && break
  git merge -q --no-edit origin/main 2>&1 | grep CONFLICT && { echo CONFLICT; exit 1; }
  sleep $((2**i))
done
[ -n "$BR" ] && git push -q -f origin HEAD:"$BR"
echo main=$(git rev-parse --short origin/main) head=$(git rev-parse --short HEAD)
