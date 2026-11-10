#!/bin/bash
# The engine: the collection code (paths in .github/engine-paths) lives on a
# branch of the private repo and is copied into the checkout before it runs.
#
# In Actions (the "Engine checkout" step, .github/actions/engine/action.yml):
#   engine.sh plan              decide in-repo or private (MODE, HAVE_TOKEN), write step outputs,
#                               and install the commit guard (engine.sh hook)
#   engine.sh hook              install the job's commit guard: a new file under data/ whose name date
#                               is more than 2 days ahead (UTC) is left out of the commit with a warning
#                               and a COMMIT-GUARD line in the message (cron_health.py commit-guard row),
#                               unless .github/future-dated-data.txt lists it (Nov 4, 2026: a test's
#                               made-up day, data/daily-sent/2099-01-01.json, reached main in a commit)
#   engine.sh overlay <dir>     copy the engine paths from <dir> (the private checkout) into place;
#                               a same-named engine branch checked out at .engine-pair wins over <dir>
# In a local session (from anywhere inside the checkout):
#   engine.sh pull              clone or update the engine next to this checkout
#                               (ENGINE_DIR, default ../<repo>-engine) and copy it in; the engine
#                               branch is ENGINE_BRANCH, else the one named like this checkout's
#                               branch when the engine has it, else the default branch
#   engine.sh pair [branch]     print the engine branch a run of <branch> uses (default: this
#                               checkout's branch): the same-named engine branch when it exists
#                               on ENGINE_REMOTE, else the default
#   engine.sh save [message]    copy this checkout's engine paths back into ENGINE_DIR and
#                               commit there (it does not push; it prints the push line)
#   engine.sh only-engine [dir] refuse (exit 1) when a file under the engine paths is in the
#                               engine clone's HEAD (dir, default ENGINE_DIR) and not in this
#                               checkout's HEAD, unless this checkout's history deleted or renamed
#                               it since the engine's last sync (the "agsist main <sha>" in the
#                               engine's newest sync commit message): then save deletes it there
#                               too, as main did. Prints counts, no names.
#                               .github/workflows/engine-sync.yml runs it before every save.
#
# Rules:
# - While this repository still tracks a path, the copy never overwrites a
#   tracked file: the checkout stays clean, so a job's `git pull --rebase`
#   cannot stop on a code file. Once the code is gone from this repository the
#   engine copy is the only copy.
# - In Actions, every engine path (and the scratch checkout) goes into
#   .git/info/exclude, so a job's bare `git add -A` can never put private code
#   in this repository. A local `pull` does not touch info/exclude (it is shared
#   by every worktree of a clone and would hide new files from git status);
#   locally .gitignore covers the paths once the code has left this repository.
# - The key is never printed: it reaches only actions/checkout (with
#   persist-credentials false, so it is not left in .git/config either).
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "engine: not inside a git checkout" >&2; exit 1; }
CONF="$ROOT/.github/engine-paths"
[ -f "$CONF" ] || { echo "engine: $CONF is missing" >&2; exit 1; }
REPO=$(awk '$1=="repo"{print $2}' "$CONF")
BRANCH=$(awk '$1=="branch"{print $2}' "$CONF")
FIXED_MODE=$(awk '$1=="mode"{print $2}' "$CONF")
mapfile -t PATHS < <(awk '$1=="path"{print $2}' "$CONF")
SCRATCH=.engine-src
PAIR=.engine-pair
MAIN_BRANCH=main

say_fail() {
  # one loud line in the log and in the job summary, then stop
  echo "::error title=engine checkout failing::$1"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Engine checkout failing\n\n%s\n\nNothing was run or published by this job.\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  exit 1
}

exclude_paths() {
  local ex; ex="$(git -C "$ROOT" rev-parse --git-path info/exclude)"
  case "$ex" in /*) ;; *) ex="$ROOT/$ex" ;; esac
  mkdir -p "$(dirname "$ex")"; touch "$ex"
  local p line
  for line in "/$SCRATCH/" "/$PAIR/" $(for p in "${PATHS[@]}"; do echo "/$p"; done); do
    grep -qxF -- "$line" "$ex" || echo "$line" >> "$ex"
  done
}

# The commit guard (Nov 4, 2026). scripts/test_list_fallback.py once wrote the sent copy of its made-up
# day, data/daily-sent/2099-01-01.json, into the real checkout, and a later commit carried it to main.
# Every job that runs code passes through this script first, so every job's `git commit` gets a
# pre-commit hook: a NEW file under data/ whose earliest date in its path (YYYY-MM-DD) is more than
# 2 days after today (UTC) is taken out of the commit with a warning. The data commit itself goes on
# (rule 15: fail soft); a commit left with nothing in it is refused, never made empty. Real future
# files (forecasts, schedules) are listed with a reason in .github/future-dated-data.txt (a line
# "<path> <reason>"; a path ending in / covers its folder). test/future-dated-data.test.mjs runs it.
GUARD_MARK="agsist commit guard (engine.sh hook)"
# A drop must reach a red row (Nov 4, 2026): a ::warning on a green data job is read by nobody, so a
# real future file with no allow-list line would be left out of every commit unseen. The pre-commit
# hook prints one fixed line, COMMIT-GUARD dropped=N path=<first path>, and leaves a note in the git
# directory; the commit-msg hook adds that same line to the commit's message. scripts/cron_health.py's
# commit-guard row reads the messages of the last 24 h of commits on main (a few API calls) and goes
# red on any. A commit left with nothing in it is still refused: that job's commit step fails, a red
# run of its own, and the line is in its log.
# Speed: only new (A) or renamed (R) paths under data/ are looked at, and the date is read with bash's own
# regex, so a first add of thousands of files takes no subprocess each. A rename onto a made-up day puts the
# old path back, so the commit carries neither half of the move. The note the commit-msg hook reads holds
# the tree being committed; a note from a commit that stopped after the hook is never used by a later one.
install_hook() {
  local hooks hook
  hooks="$(git -C "$ROOT" rev-parse --git-path hooks)"
  case "$hooks" in /*) ;; *) hooks="$ROOT/$hooks" ;; esac
  for hook in "$hooks/pre-commit" "$hooks/commit-msg"; do
    if [ -e "$hook" ] && ! grep -qF "$GUARD_MARK" "$hook"; then
      echo "::notice title=commit guard not installed::a ${hook##*/} hook is already there"; return 0
    fi
  done
  mkdir -p "$hooks"
  hook="$hooks/pre-commit"
  cat > "$hook" <<'HOOK'
#!/bin/bash
# agsist commit guard (engine.sh hook). Written by .github/actions/engine/engine.sh; see install_hook there.
root="$(git rev-parse --show-toplevel)" || exit 0
note="$(git rev-parse --git-path agsist-commit-guard)" || exit 0
rm -f "$note"
lim="$(date -u -d '+2 days' +%F)" || exit 0
allow="$root/.github/future-dated-data.txt"
re='(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'
dropped=0 first=""
while IFS= read -r -d '' st; do
  old=""
  case "$st" in R*) IFS= read -r -d '' old ;; esac
  IFS= read -r -d '' f || break
  case "$f" in data/*) ;; *) continue ;; esac
  d="" s="$f"
  while [[ "$s" =~ $re ]]; do
    m="${BASH_REMATCH[0]}"
    { [ -z "$d" ] || [[ "$m" < "$d" ]]; } && d="$m"
    s="${s#*"$m"}"
  done
  [ -n "$d" ] && [[ "$d" > "$lim" ]] || continue
  ok=0
  if [ -f "$allow" ]; then
    while read -r p _; do
      case "$p" in ''|'#'*) continue ;; */) [[ "$f" == "$p"* ]] && ok=1 ;; *) [ "$f" = "$p" ] && ok=1 ;; esac
    done < "$allow"
  fi
  [ "$ok" = 1 ] && continue
  git rm --cached -q -- "$f" || continue
  # a rename onto a made-up day: the old path goes back as it was, so the commit carries no half of the move
  [ -n "$old" ] && git reset -q HEAD -- "$old" 2>/dev/null
  dropped=$((dropped + 1)); [ -z "$first" ] && first="$f"
  echo "::warning title=test-shaped file left out of the commit::$f is dated $d, more than 2 days ahead; a test or a self-test wrote it into the checkout. Real future files go in .github/future-dated-data.txt with a reason."
done < <(git diff --cached --name-status -M --diff-filter=AR -z -- data/)
if [ "$dropped" -gt 0 ]; then
  line="COMMIT-GUARD dropped=$dropped path=$first"
  echo "$line"
  if git diff --cached --quiet; then
    echo "commit guard: nothing left to commit after $dropped test-shaped file(s) were left out"
    exit 1
  fi
  # keyed to the tree being committed: a note left by a commit that stopped after this hook (an empty
  # message, GIT_EDITOR=false) never reaches a later commit or merge, whose tree differs
  printf '%s\t%s\n' "$(git write-tree)" "$line" > "$note"
fi
exit 0
HOOK
  chmod +x "$hook"
  hook="$hooks/commit-msg"
  cat > "$hook" <<'HOOK'
#!/bin/bash
# agsist commit guard (engine.sh hook). Written by .github/actions/engine/engine.sh; see install_hook there.
# Carries the pre-commit hook's COMMIT-GUARD line into the message, so cron_health.py can see it on main.
note="$(git rev-parse --git-path agsist-commit-guard)" || exit 0
[ -s "$note" ] || exit 0
IFS=$'\t' read -r tree line < "$note"
rm -f "$note"
[ -n "$line" ] && [ "$tree" = "$(git write-tree)" ] && printf '\n%s\n' "$line" >> "$1"
exit 0
HOOK
  chmod +x "$hook"
}

# copy <src> into the checkout, path by path
# Tests come from the commit being tested (Nov 4, 2026, PR #319). A pull request's checks ran on a commit
# from before #318 while the engine was already synced with #318: the overlay added the new
# test/ai-footer-check.test.mjs (missing here, so "add what is missing"), but kept this commit's older
# scripts/dev/merge_when_green.py and pr-checks.yml, and two tests failed on code they never had. On a
# pull request run (GITHUB_EVENT_NAME pull_request or pull_request_target) the overlay adds nothing under
# TESTS_FROM_COMMIT that this commit lacks: the tests and the dev tools they test are this commit's own.
# What stays overlaid there: the rest of scripts/ and build/ (collection code a job runs; a file this
# commit lacks is code it does not call, and once the public copy is retired the engine is the only copy),
# and every path this repository no longer tracks at all (then the engine is the only copy, tests too).
# Main's runs (push, schedule, workflow_run, a dispatch, main-checks.yml's call of pr-checks) are not
# pull request runs and get the whole engine as before.
TESTS_FROM_COMMIT=("test/" "scripts/dev/")
from_commit() {
  local t
  for t in "${TESTS_FROM_COMMIT[@]}"; do [[ "$1" == "$t"* ]] && return 0; done
  return 1
}

overlay_from() {
  local src="$1" excl="${2:-exclude}" p kept=0 n pr=0 held
  case "${GITHUB_EVENT_NAME:-}" in pull_request|pull_request_target) pr=1 ;; esac
  [ "$excl" = "local" ] && pr=0
  held="$(mktemp)"
  for p in "${PATHS[@]}"; do
    [ -e "$src/$p" ] || say_fail "the engine branch $BRANCH has no $p"
  done
  [ "$excl" = "exclude" ] && exclude_paths
  for p in "${PATHS[@]}"; do
    if [ -n "$(git -C "$ROOT" ls-files -- "$p" | head -1)" ]; then
      # still tracked here: add what is missing, never overwrite
      n=$(git -C "$ROOT" ls-files -z -- "$p" | (cd "$ROOT" && while IFS= read -r -d '' f; do
            [ -f "$src/$f" ] && [ -f "$f" ] && ! cmp -s "$src/$f" "$f" && echo x; done) | wc -l)
      kept=$((kept + n))
      (cd "$src" && find "$p" \( -type f -o -type l \) -print0) | while IFS= read -r -d '' f; do
        [ -e "$ROOT/$f" ] || [ -L "$ROOT/$f" ] && continue
        if [ "$pr" = 1 ] && from_commit "$f"; then echo "$f" >> "$held"; continue; fi
        mkdir -p "$ROOT/$(dirname "$f")" && cp -a "$src/$f" "$ROOT/$f" || exit 1
      done || say_fail "could not copy $p from the engine"
    else
      rm -rf "${ROOT:?}/$p"
      cp -a "$src/$p" "$ROOT/$p" || say_fail "could not copy $p from the engine"
    fi
  done
  n=$(wc -l < "$held"); rm -f "$held"
  if [ "$n" -gt 0 ]; then
    echo "::notice title=tests from this commit::$n engine file(s) under ${TESTS_FROM_COMMIT[*]} that this commit does not have were left out (a pull request run tests its own commit)"
  fi
  if [ "$kept" -gt 0 ]; then
    echo "::notice title=engine older than this repository::$kept file(s) differ from this repository's copy; this repository's copy was used (it still tracks the code). Bring the engine up to date: bash .github/actions/engine/engine.sh save"
  fi
}

# A branch name a run may pair with: plain characters only, never the default or main.
pair_name() {
  local b="${1:-}"
  [ -n "$b" ] && [ "$b" != "$BRANCH" ] && [ "$b" != "$MAIN_BRANCH" ] || return 1
  [[ "$b" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$b" != *..* ]] && git check-ref-format --branch "$b" >/dev/null 2>&1
}

# The engine wins (Nov 5, 2026, curtain step P1). In private mode a run on main, or a run whose
# same-named engine branch was checked out (a pull request fx/x with fx/x on the engine), uses the
# engine's copy of every engine path, even while this repository still tracks the code. The tracked
# copy is set aside with a sparse checkout (patterns kept, the engine paths left out) and
# sparse.expectFilesOutsideOfPatterns, so the engine's files sit where the code was, git sees them as
# outside the checkout: `git status` stays clean, a bare `git add -A` never stages them, and a
# `git pull --rebase` over a code change on main goes through (it updates the index only). A file this
# commit tracks that the engine lacks (the engine a few minutes behind a merge) is taken from this
# commit, with a notice counting them.
set_aside() {
  local sp was
  sp="$(git -C "$ROOT" rev-parse --git-path info/sparse-checkout)"
  case "$sp" in /*) ;; *) sp="$ROOT/$sp" ;; esac
  was="$(git -C "$ROOT" config --bool core.sparseCheckout 2>/dev/null || echo false)"
  {
    if [ "$was" = "true" ] && [ -s "$sp" ]; then
      grep -v '^[[:space:]]*$' "$sp"     # the patterns as written (cone mode writes them out in full too)
    else
      echo '/*'
      git -C "$ROOT" config agsist.engineSparse full   # a full checkout: check_site_budget.py still walks it
    fi
    for p in "${PATHS[@]}"; do printf '!/%s/\n!/%s/**\n' "$p" "$p"; done
  } > "$sp.engine" || return 1
  git -C "$ROOT" config sparse.expectFilesOutsideOfPatterns true || return 1
  git -C "$ROOT" sparse-checkout set --no-cone --stdin < "$sp.engine" 2>&1 | grep -v 'leading slash' >&2
  local rc=${PIPESTATUS[0]}
  rm -f "$sp.engine"
  return "$rc"
}

engine_take() {
  local src="$1" p n=0 diff=0 mode hash f tracked
  for p in "${PATHS[@]}"; do
    [ -e "$src/$p" ] || say_fail "the engine branch has no $p"
  done
  exclude_paths
  tracked="$(git -C "$ROOT" ls-files -- "${PATHS[@]}" | head -1)"
  if [ -n "$tracked" ]; then
    set_aside || say_fail "could not set this repository's copy of the code aside"
    diff=$(git -C "$ROOT" ls-files -s -- "${PATHS[@]}" | while read -r mode hash _ f; do
             [ -f "$src/$f" ] && [ "$(git hash-object --no-filters -- "$src/$f")" != "$hash" ] && echo x; done | wc -l)
  fi
  for p in "${PATHS[@]}"; do
    rm -rf "${ROOT:?}/$p"
    cp -a "$src/$p" "$ROOT/$p" || say_fail "could not copy $p from the engine"
  done
  if [ -n "$tracked" ]; then
    n=$(git -C "$ROOT" ls-files -s -z -- "${PATHS[@]}" | (cd "$ROOT" && while IFS= read -r -d '' rec; do
          f="${rec#*$'\t'}"; read -r mode hash _ <<< "${rec%%$'\t'*}"
          [ -e "$f" ] || [ -L "$f" ] && continue
          mkdir -p "$(dirname "$f")" || exit 1
          case "$mode" in
            120000) ln -s "$(git cat-file blob "$hash")" "$f" ;;
            100755) git cat-file blob "$hash" > "$f" && chmod +x "$f" ;;
            100644) git cat-file blob "$hash" > "$f" ;;
            *) continue ;;
          esac || { echo FAIL; exit 1; }
          echo x; done) | sort | uniq -c | awk '$2=="x"{n=$1} $2=="FAIL"{f=1} END{print f ? "fail" : n+0}')
    [ "$n" = "fail" ] && say_fail "could not take a file the engine lacks from this commit"
    # anything git still counts as a change under the engine paths would reach a job's commit
    git -C "$ROOT" ls-files -t -z -- "${PATHS[@]}" | tr '\0' '\n' | awk '$1!="S"{sub(/^[^ ]+ /,""); print}' |
      (cd "$ROOT" && xargs -r -d '\n' git update-index --skip-worktree --) || say_fail "could not set this repository's copy of the code aside"
    [ -z "$(git -C "$ROOT" status --porcelain -- "${PATHS[@]}" | head -1)" ] ||
      say_fail "the engine copy shows as a change to this repository; nothing was run"
  fi
  if [ "$n" -gt 0 ]; then
    echo "::notice title=engine behind this commit::$n file(s) this commit has and the engine lacks were taken from this commit"
  fi
  if [ "$diff" -gt 0 ]; then
    echo "::notice title=engine differs from this commit::$diff file(s) differ from this repository's copy; the engine copy was used"
  fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  hook)
    install_hook
    echo "engine: commit guard installed" ;;
  behind)
    # A push to main that changes engine paths starts its jobs at once, while engine-sync is still copying that
    # change to the engine branch (Nov 6: sponsor-report on #372 read its checks 2 s before the sync landed and
    # failed on the old copy). With the engine checked out in <dir>, this says whether that copy predates such a
    # push; if it does it waits until WAIT_SECONDS after the push and writes retry=true, and the action checks the
    # engine out once more. It holds no key and never fails the job.
    src="${1:?behind needs the engine checkout directory}"
    case "$src" in /*) ;; *) src="$ROOT/$src" ;; esac
    out="${GITHUB_OUTPUT:-/dev/null}"; ev="${GITHUB_EVENT_PATH:-}"
    [ "${GITHUB_EVENT_NAME:-}" = "push" ] && [ -f "$ev" ] && [ -e "$src/.git" ] || { echo "retry=false" >> "$out"; exit 0; }
    # which files the push changed: the event's own lists, and git's view of the commit itself (Nov 6: the first live
    # run, the push of #381, found no engine path in the event and did not wait though the engine was 5 minutes behind)
    changed="$(mktemp)"
    pushed_git=""
    if [ "${ENGINE_BEHIND_GIT:-1}" = "1" ]; then
      # a CI checkout is one commit deep: fetch the parent so the commit's own change list can be read (a full local
      # clone is never made shallow)
      [ "$(git -C "$ROOT" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ] &&
        timeout 60 git -C "$ROOT" fetch -q --depth=2 origin "${GITHUB_SHA:-HEAD}" 2>/dev/null
      # the push's own commit, not HEAD: a job that checks out ref: main can be on a newer bot commit
      c="${GITHUB_SHA:-HEAD}"
      git -C "$ROOT" diff --no-renames --name-only "$c~1" "$c" >> "$changed" 2>/dev/null || true
      pushed_git="$(git -C "$ROOT" log -1 --format=%cI "$c" 2>/dev/null || true)"
    fi
    verdict=$(python3 - "$ev" "$(git -C "$src" log -1 --format=%cI)" "${WAIT_SECONDS:-120}" "$changed" "$pushed_git" "${PATHS[@]}" <<'PY'
import json, sys
from datetime import datetime, timezone
ev = json.load(open(sys.argv[1])); engine, limit, changed, pushed_git = sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
paths = sys.argv[6:]
hc = ev.get("head_commit") or {}
files = [f for c in (ev.get("commits") or [hc]) for k in ("added", "modified", "removed") for f in (c.get(k) or [])]
files += [l.strip() for l in open(changed) if l.strip()]
hit = [f for f in files if any(f == p or f.startswith(p.rstrip("/") + "/") for p in paths)]
if not hit:
    print("fresh this push changes no engine path (%d file(s) listed)" % len(files)); sys.exit()
stamp = hc.get("timestamp") or pushed_git
if not stamp:
    print("fresh no time for this push"); sys.exit()
t = lambda x: datetime.fromisoformat(x.replace("Z", "+00:00"))
pushed = t(stamp)
if t(engine) >= pushed:
    print("fresh the engine copy (%s) is not older than this push (%s)" % (engine, stamp)); sys.exit()
print("behind %d" % max(0, int(limit - (datetime.now(timezone.utc) - pushed).total_seconds())))
PY
)
    rm -f "$changed"
    case "$verdict" in
      behind*) s=${verdict#behind }; echo "engine: the engine copy predates this push; waiting ${s}s for engine-sync, then checking out again"
               [ "$s" -gt 0 ] && sleep "$s"; echo "retry=true" >> "$out" ;;
      *) echo "engine: no second checkout (${verdict:-no verdict})"; echo "retry=false" >> "$out" ;;
    esac ;;
  plan)
    install_hook
    mode="${FIXED_MODE:-${MODE:-}}"
    out="${GITHUB_OUTPUT:-/dev/null}"
    if [ "$mode" = "private" ]; then
      [ "${HAVE_TOKEN:-false}" = "true" ] || say_fail "PRIVATE_REPO_TOKEN is not set in this repository's Actions secrets (needed to read $REPO $BRANCH)"
      exclude_paths
      # a run on fx/x (a pull request's head, a dispatch or push on that branch) tries the engine
      # branch fx/x first, so it runs its own branch's code (build rule 62, 66); main and the rest
      # use the default engine branch
      # never on pull_request_target: it runs with a write token, and a head branch name is the PR's to pick
      paired=""
      [ "${GITHUB_EVENT_NAME:-}" != "pull_request_target" ] && pair_name "${RUN_BRANCH:-}" && paired="$RUN_BRANCH"
      { echo "private=true"; echo "repo=$REPO"; echo "ref=$BRANCH"; echo "paired=$paired"; } >> "$out"
      echo "engine: private, $REPO $BRANCH${paired:+ (the same-named engine branch $paired first, when it exists)}"
    elif [ -z "$mode" ] || [ "$mode" = "in-repo" ]; then
      have=0; for p in "${PATHS[@]}"; do [ -e "$ROOT/$p" ] && have=1; done
      [ "$have" = 1 ] || say_fail "the code is not in this repository (${PATHS[*]}); set the repository variable ENGINE_MODE=private"
      echo "private=false" >> "$out"
      echo "engine: in-repo (this repository's own ${PATHS[*]})"
    else
      say_fail "ENGINE_MODE is '$mode'; use private or leave it empty"
    fi ;;
  overlay)
    src="${1:?overlay needs the engine checkout directory}"
    case "$src" in /*) ;; *) src="$ROOT/$src" ;; esac
    pair="$ROOT/$PAIR"
    pr=0; case "${GITHUB_EVENT_NAME:-}" in pull_request|pull_request_target) pr=1 ;; esac
    if [ "${GITHUB_EVENT_NAME:-}" != "pull_request_target" ] && [ "${PAIRED_OUTCOME:-}" = "success" ] && [ -n "${PAIRED:-}" ] && [ -d "$pair/.git" -o -f "$pair/.git" ]; then
      # the run's own engine branch: its code wins, tests included
      from="$PAIRED"; sha=$(git -C "$pair" rev-parse HEAD)
      engine_take "$pair"
      how="the engine copy"
    else
      [ "${CHECKOUT_OUTCOME:-success}" = "success" ] && [ -d "$src/.git" -o -f "$src/.git" ] ||
        say_fail "could not check out $REPO $BRANCH (key expired, revoked, not granted on $REPO, or the branch is gone)"
      from="$BRANCH"; sha=$(git -C "$src" rev-parse HEAD)
      if [ "$pr" = 0 ] && [ "${RUN_BRANCH:-}" = "$MAIN_BRANCH" ]; then
        engine_take "$src"
        how="the engine copy"
      else
        # a pull request or a branch run with no same-named engine branch: this commit's own code
        # (while it still has it) is what is being tested
        overlay_from "$src"
        how="this commit's copy where it has one"
      fi
    fi
    rm -rf "$src" "$pair"
    echo "engine: $sha from $from ($REPO), paths ${PATHS[*]}, $how"
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "sha=$sha" >> "$GITHUB_OUTPUT"
    true ;;
  pair)
    b="${1:-$(git -C "$ROOT" symbolic-ref --short -q HEAD || true)}"
    remote="${ENGINE_REMOTE:-https://github.com/$REPO.git}"
    if pair_name "$b" && git ls-remote --exit-code --heads "$remote" "refs/heads/$b" >/dev/null 2>&1; then
      echo "$b"
    else
      echo "$BRANCH"
    fi ;;
  pull)
    ED="${ENGINE_DIR:-$(dirname "$ROOT")/$(basename "$ROOT")-engine}"
    EB="${ENGINE_BRANCH:-$(bash "$0" pair)}"
    if [ -e "$ED/.git" ]; then
      git -C "$ED" fetch -q origin "$EB" || { echo "engine: could not fetch $EB into $ED" >&2; exit 1; }
      if [ "$(git -C "$ED" symbolic-ref --short -q HEAD)" != "$EB" ]; then
        git -C "$ED" checkout -q "$EB" 2>/dev/null || git -C "$ED" checkout -q -b "$EB" FETCH_HEAD ||
          { echo "engine: could not switch $ED to $EB" >&2; exit 1; }
      fi
      git -C "$ED" merge -q --ff-only FETCH_HEAD || { echo "engine: could not update $ED" >&2; exit 1; }
    else
      git clone -q -b "$EB" "${ENGINE_REMOTE:-https://github.com/$REPO.git}" "$ED" || { echo "engine: could not clone $REPO $EB into $ED" >&2; exit 1; }
    fi
    overlay_from "$ED" local
    echo "engine: $(git -C "$ED" rev-parse --short HEAD) ($EB) from $ED copied into $ROOT (${PATHS[*]})" ;;
  save)
    ED="${ENGINE_DIR:-$(dirname "$ROOT")/$(basename "$ROOT")-engine}"
    [ -e "$ED/.git" ] || { echo "engine: no engine clone at $ED (run engine.sh pull first)" >&2; exit 1; }
    for p in "${PATHS[@]}"; do
      [ -e "$ROOT/$p" ] || { echo "engine: $ROOT/$p is missing; nothing saved" >&2; exit 1; }
    done
    for p in "${PATHS[@]}"; do rm -rf "${ED:?}/$p"; cp -a "$ROOT/$p" "$ED/$p"; done
    # cp -a keeps each file's mtime, so a changed file of the same size can match the old index entry's
    # stat data (an inode reused by rm then cp); drop the paths from the index and add them again so
    # every file is hashed (Nov 4, 2026: a same-size edit was saved as "nothing to save" under load)
    git -C "$ED" rm -r -q --cached --ignore-unmatch -- "${PATHS[@]}" >/dev/null
    git -C "$ED" add -A -- "${PATHS[@]}"
    if git -C "$ED" diff --cached --quiet; then echo "engine: nothing to save"; exit 0; fi
    git -C "$ED" -c user.name="${GIT_AUTHOR_NAME:-dnilgis}" -c user.email="${GIT_AUTHOR_EMAIL:-dnilgis@users.noreply.github.com}" \
      commit -q -m "${1:-engine: from $(basename "$ROOT") $(git -C "$ROOT" rev-parse --short HEAD)}" || exit 1
    git -C "$ED" show --stat --format='engine: committed %h %s' HEAD | tail -n +1 | head -20
    echo "push it: git -C $ED push origin $BRANCH" ;;
  only-engine)
    ED="${1:-${ENGINE_DIR:-$(dirname "$ROOT")/$(basename "$ROOT")-engine}}"
    case "$ED" in /*) ;; *) ED="$ROOT/$ED" ;; esac
    [ -e "$ED/.git" ] || { echo "engine: no engine clone at $ED" >&2; exit 1; }
    m=$(git -C "$ED" ls-tree -r --name-only HEAD -- "${PATHS[@]}" | wc -l)
    if [ "$m" -eq 0 ]; then echo "::error title=engine sync refused::the engine clone has no file under ${PATHS[*]}"; exit 1; fi
    only=$(LC_ALL=C comm -23 <(git -C "$ED" ls-tree -r --name-only HEAD -- "${PATHS[@]}" | LC_ALL=C sort) \
                            <(git -C "$ROOT" ls-tree -r --name-only HEAD -- "${PATHS[@]}" | LC_ALL=C sort))
    [ -n "$only" ] || { echo "engine: no file only in the engine ($m files under ${PATHS[*]})"; exit 0; }
    n=$(printf '%s\n' "$only" | wc -l)
    # the main commit the engine was last synced to, from the engine's newest sync message
    last=$(git -C "$ED" log -50 --format=%s | sed -nE 's/.*agsist main ([0-9a-f]{7,40}).*/\1/p' | head -1)
    gone=""
    if [ -n "$last" ] && git -C "$ROOT" cat-file -e "$last^{commit}" 2>/dev/null; then
      # what main deleted, or renamed away, since then (old names of renames are the second field)
      gone=$(git -C "$ROOT" log -M --diff-filter=DR --name-status --format= "$last..HEAD" -- "${PATHS[@]}" |
             awk -F'\t' '$1=="D"{print $2} $1 ~ /^R/{print $2}' | LC_ALL=C sort -u)
    fi
    left=$(LC_ALL=C comm -23 <(printf '%s\n' "$only" | LC_ALL=C sort) <(printf '%s\n' "$gone" | sed '/^$/d'))
    k=$(printf '%s\n' "$left" | sed '/^$/d' | wc -l)
    if [ "$k" -gt 0 ]; then
      why="main never had them since the last sync"
      [ -n "$last" ] || why="no sync commit (agsist main <sha>) found in the engine's history"
      [ -z "$last" ] || git -C "$ROOT" cat-file -e "$last^{commit}" 2>/dev/null || why="the last sync commit $last is not in this checkout's history"
      echo "::error title=engine sync refused::$k file(s) exist only in the engine branch $BRANCH ($why); a save would delete them. Look by hand (git -C <engine clone> ls-tree against main) before any sync."
      exit 1
    fi
    echo "engine: $n file(s) only in the engine were deleted or renamed on main since $last; the save deletes them there too ($m files under ${PATHS[*]})" ;;
  *)
    sed -n '2,32p' "$0"; exit 2 ;;
esac
