#!/bin/bash
# Save raw build inputs to the `raw` branch, never to main.
#
# GitHub Pages publishes everything on main. Raw captures (probe answers, AMS
# PDFs and their text, the Farmland Atlas pulls in data/atlas/raw/) are read by
# our scripts and by people checking a parser, never by a page, so they live on
# the `raw` branch: no shared history with main, never deployed, nothing there
# counts toward the 1 GB site limit. Same paths as they had on main
# (data/atlas/raw/heat.json is data/atlas/raw/heat.json there too).
#
#   bash scripts/push_raw.sh "<what this is>" <path> [<path> ...]
#
# Each path (a file or a folder, relative to the repo root) is copied OVER the
# same path on raw: new and changed files land, nothing already there is
# deleted (Sig: "don't throw away anything important"; git history keeps every
# old version too). Commits as agsist-bot and pushes, retrying on a moved tip
# the way refs.yml does for the references branch. Every git failure is printed
# as a ::warning:: with git's own words, because the job log is not always
# readable from where we look.
#
# Read them back with scripts/pull_raw.sh, or by hand:
#   git fetch origin raw && git archive FETCH_HEAD data/atlas/raw | tar -x
# The moved paths are in .gitignore on main, so a copy unpacked into a checkout
# is never committed to main by accident.
#
# Test knobs (test/raw-branch.test.mjs): RAW_REMOTE (default origin),
# RAW_BRANCH (default raw), RAW_WT (where the raw worktree goes; default
# outside the checkout, so the site budget never counts it), RAW_SLEEP
# (seconds per retry step, default 10).
set -u
set -o pipefail
MSG="${1:-}"
[ -n "$MSG" ] || { echo "::error::push_raw.sh: first argument is the commit message"; exit 1; }
shift
[ $# -gt 0 ] || { echo "::error::push_raw.sh: no paths given"; exit 1; }
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
REMOTE="${RAW_REMOTE:-origin}"
BR="${RAW_BRANCH:-raw}"
RAW="${RAW_WT:-$(dirname "$ROOT")/raw-branch}"
STEP="${RAW_SLEEP:-10}"

g() { local out; if out=$(git "$@" 2>&1); then return 0; fi
      echo "::warning::git $1 failed: $(printf '%s' "$out" | tail -5 | tr '\n' ' ')"; return 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
HAVE=()
for p in "$@"; do
  case "$p" in
    /*|..|../*|*/../*|*/..) echo "::error::push_raw.sh: $p must be a path inside the repo"; exit 1;;
  esac
  if [ -e "$p" ]; then cp -r --parents "$p" "$STAGE/" || exit 1; HAVE+=("$p")
  else echo "::warning::push_raw.sh: $p was not written; nothing to save for it"; fi
done
if [ "${#HAVE[@]}" -eq 0 ]; then echo "::warning::push_raw.sh: none of the paths exist; nothing saved to $BR"; exit 0; fi

# THE MAIN CHECKOUT MAY BE SPARSE, AND A NEW WORKTREE COPIES ITS SPARSE
# PATTERNS (git 2.38+). refs.yml's first run (2026-10-15) got a worktree with
# nothing checked out and `git add` refused every path. So: add it without a
# checkout, turn sparse off for that worktree only, then fill it.
if [ ! -e "$RAW/.git" ]; then
  g fetch -q --depth 1 "$REMOTE" "$BR" || { echo "::error::the $BR branch is missing on $REMOTE; push it first (raw files not saved)"; exit 1; }
  g worktree add -q --no-checkout -B "$BR" "$RAW" FETCH_HEAD || exit 1
  git -C "$RAW" sparse-checkout disable >/dev/null 2>&1 || true
  g -C "$RAW" reset -q --hard || exit 1
fi
test -f "$RAW/README.md" || { echo "::error::the $BR worktree came out empty (no README.md); not committing"; exit 1; }

cd "$RAW" || exit 1
for i in 1 2 3 4 5; do
  g fetch -q --depth 1 "$REMOTE" "$BR" || { sleep $((STEP * i)); continue; }
  g reset -q --hard FETCH_HEAD || exit 1
  test -f README.md || { echo "::error::README.md missing on $BR after reset; not committing"; exit 1; }
  cp -r "$STAGE/." . || exit 1
  g add -A -- "${HAVE[@]}" || exit 1
  if git diff --cached --quiet; then echo "raw: no change"; exit 0; fi
  N=$(git diff --cached --name-only | wc -l)
  g -c user.name=agsist-bot -c user.email=bot@agsist.com commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ): $N file(s)" || exit 1
  if g push -q "$REMOTE" "HEAD:$BR"; then echo "raw: pushed $(git rev-parse --short HEAD) ($N file(s)) to $BR"; exit 0; fi
  sleep $((STEP * i))
done
echo "::error::could not push the $BR branch after 5 tries (see the warnings above)"; exit 1
