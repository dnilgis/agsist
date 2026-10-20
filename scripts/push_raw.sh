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
# WHERE IT GOES (Oct 20, 2026): the branches moved to the private repo
# dnilgis/agsistretired. In Actions the step passes PRIVATE_REPO_TOKEN and this
# pushes there; scripts/private_remote.sh has the rules (RAW_REMOTE wins, no
# token means origin). RAW_BRANCH=private-data saves the job files no page reads
# (private/data/cron-health.json and the like) to that branch instead.
#
# RAW_SOFT=1 (the workflows set it): a save that fails prints a ::warning::,
# notes it in the job summary and exits 0, so the run still publishes the site
# data. cron_health.py's private-repo row turns red when the saves stop landing
# (the private branches go stale) or the key fails, and the morning email shows
# it. Without RAW_SOFT every failure exits 1, as before.
#
# Knobs (test/raw-branch.test.mjs): RAW_REMOTE (see above), RAW_BRANCH
# (default raw), RAW_WT (where the branch worktree goes; default
# ../<branch>-branch, outside the checkout, so the site budget never counts
# it), RAW_SLEEP (seconds per retry step, default 10), RAW_SOFT.
set -u
set -o pipefail
MSG="${1:-}"
[ -n "$MSG" ] || { echo "::error::push_raw.sh: first argument is the commit message"; exit 1; }
shift
[ $# -gt 0 ] || { echo "::error::push_raw.sh: no paths given"; exit 1; }
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
. "$ROOT/scripts/private_remote.sh" || { echo "::error::push_raw.sh: scripts/private_remote.sh is missing"; exit 1; }
BR="${RAW_BRANCH:-raw}"
RAW="${RAW_WT:-$(dirname "$ROOT")/$BR-branch}"
STEP="${RAW_SLEEP:-10}"

g() { local out; if out=$(git "$@" 2>&1); then return 0; fi
      echo "::warning::git $1 failed: $(printf '%s' "$out" | tail -5 | tr '\n' ' ' | hide)"; return 1; }
# A failed save. Hard (exit 1) unless RAW_SOFT=1; soft keeps the run going.
fail() {
  if [ "${RAW_SOFT:-}" = 1 ]; then
    echo "::warning::not saved to $BR on $WHERE: $* (the site data is unaffected)"
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- private save failed: $MSG to $BR: $*" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  echo "::error::$*"; exit 1
}

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

# SECRETS OUT FIRST. Saved third-party pages carry their owners' keys (Maps,
# Stripe, Mapbox...), and GitHub push protection then refuses the whole push
# (elevsites, land-data, Oct 2026). The staged copy is redacted, never the
# originals; if the redactor cannot run, nothing is pushed.
python3 "$ROOT/scripts/redact_secrets.py" "$STAGE" || fail "push_raw.sh: redact_secrets.py failed; not pushing"

# THE MAIN CHECKOUT MAY BE SPARSE, AND A NEW WORKTREE COPIES ITS SPARSE
# PATTERNS (git 2.38+). refs.yml's first run (2026-10-15) got a worktree with
# nothing checked out and `git add` refused every path. So: add it without a
# checkout, turn sparse off for that worktree only, then fill it.
if [ ! -e "$RAW/.git" ]; then
  g fetch -q --depth 1 "$REMOTE" "$BR" || fail "the $BR branch is missing on $WHERE, or the key cannot read it; push it first (raw files not saved)"
  g worktree add -q --no-checkout -B "$BR" "$RAW" FETCH_HEAD || fail "could not add the $BR worktree"
  git -C "$RAW" sparse-checkout disable >/dev/null 2>&1 || true
  g -C "$RAW" reset -q --hard || fail "could not fill the $BR worktree"
fi
test -f "$RAW/README.md" || fail "the $BR worktree came out empty (no README.md); not committing"

cd "$RAW" || fail "no $BR worktree"
for i in 1 2 3 4 5; do
  g fetch -q --depth 1 "$REMOTE" "$BR" || { sleep $((STEP * i)); continue; }
  g reset -q --hard FETCH_HEAD || fail "could not reset to the $BR tip"
  test -f README.md || fail "README.md missing on $BR after reset; not committing"
  cp -r "$STAGE/." . || fail "could not copy the files in"
  g add -A -- "${HAVE[@]}" || fail "git add refused the files"
  if git diff --cached --quiet; then echo "raw: no change"; exit 0; fi
  N=$(git diff --cached --name-only | wc -l)
  g -c user.name=agsist-bot -c user.email=bot@agsist.com commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ): $N file(s)" || fail "could not commit"
  if g push -q "$REMOTE" "HEAD:$BR"; then echo "raw: pushed $(git rev-parse --short HEAD) ($N file(s)) to $BR on $WHERE"; exit 0; fi
  sleep $((STEP * i))
done
fail "could not push the $BR branch after 5 tries (see the warnings above)"
