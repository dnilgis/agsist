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
#   engine.sh overlay <dir>     copy the engine paths from <dir> (the private checkout) into place
# In a local session (from anywhere inside the checkout):
#   engine.sh pull              clone or update the engine next to this checkout
#                               (ENGINE_DIR, default ../<repo>-engine) and copy it in
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
  for line in "/$SCRATCH/" $(for p in "${PATHS[@]}"; do echo "/$p"; done); do
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
# Speed: only new (A) or renamed (R) paths under data/ that carry a date at all are looked at, and the
# date is read with bash's own regex, so a first add of thousands of files takes no subprocess each.
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
while IFS= read -r -d '' f; do
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
  git rm --cached -q -- "$f" && dropped=$((dropped + 1)) && [ -z "$first" ] && first="$f"
  echo "::warning title=test-shaped file left out of the commit::$f is dated $d, more than 2 days ahead; a test or a self-test wrote it into the checkout. Real future files go in .github/future-dated-data.txt with a reason."
done < <(git diff --cached --name-only -M --diff-filter=AR -z -- data/ | grep -zE "$re")
if [ "$dropped" -gt 0 ]; then
  line="COMMIT-GUARD dropped=$dropped path=$first"
  echo "$line"
  if git diff --cached --quiet; then
    echo "commit guard: nothing left to commit after $dropped test-shaped file(s) were left out"
    exit 1
  fi
  printf '%s\n' "$line" > "$note"
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
printf '\n%s\n' "$(cat "$note")" >> "$1"
rm -f "$note"
exit 0
HOOK
  chmod +x "$hook"
}

# copy <src> into the checkout, path by path
overlay_from() {
  local src="$1" excl="${2:-exclude}" p kept=0 n
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
        mkdir -p "$ROOT/$(dirname "$f")" && cp -a "$src/$f" "$ROOT/$f" || exit 1
      done || say_fail "could not copy $p from the engine"
    else
      rm -rf "${ROOT:?}/$p"
      cp -a "$src/$p" "$ROOT/$p" || say_fail "could not copy $p from the engine"
    fi
  done
  if [ "$kept" -gt 0 ]; then
    echo "::notice title=engine older than this repository::$kept file(s) differ from this repository's copy; this repository's copy was used (it still tracks the code). Bring the engine up to date: bash .github/actions/engine/engine.sh save"
  fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  hook)
    install_hook
    echo "engine: commit guard installed" ;;
  plan)
    install_hook
    mode="${FIXED_MODE:-${MODE:-}}"
    out="${GITHUB_OUTPUT:-/dev/null}"
    if [ "$mode" = "private" ]; then
      [ "${HAVE_TOKEN:-false}" = "true" ] || say_fail "PRIVATE_REPO_TOKEN is not set in this repository's Actions secrets (needed to read $REPO $BRANCH)"
      exclude_paths
      { echo "private=true"; echo "repo=$REPO"; echo "ref=$BRANCH"; } >> "$out"
      echo "engine: private, $REPO $BRANCH"
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
    [ "${CHECKOUT_OUTCOME:-success}" = "success" ] && [ -d "$src/.git" -o -f "$src/.git" ] ||
      say_fail "could not check out $REPO $BRANCH (key expired, revoked, not granted on $REPO, or the branch is gone)"
    sha=$(git -C "$src" rev-parse HEAD)
    overlay_from "$src"
    rm -rf "$src"
    echo "engine: $sha from $BRANCH ($REPO), paths ${PATHS[*]}"
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "sha=$sha" >> "$GITHUB_OUTPUT"
    true ;;
  pull)
    ED="${ENGINE_DIR:-$(dirname "$ROOT")/$(basename "$ROOT")-engine}"
    if [ -e "$ED/.git" ]; then
      git -C "$ED" fetch -q origin "$BRANCH" && git -C "$ED" merge -q --ff-only "origin/$BRANCH" || { echo "engine: could not update $ED" >&2; exit 1; }
    else
      git clone -q -b "$BRANCH" "${ENGINE_REMOTE:-https://github.com/$REPO.git}" "$ED" || { echo "engine: could not clone $REPO $BRANCH into $ED" >&2; exit 1; }
    fi
    overlay_from "$ED" local
    echo "engine: $(git -C "$ED" rev-parse --short HEAD) from $ED copied into $ROOT (${PATHS[*]})" ;;
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
    git -C "$ED" -c user.name="${GIT_AUTHOR_NAME:-dnilgis}" -c user.email="${GIT_AUTHOR_EMAIL:-dnilgis@gmail.com}" \
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
    sed -n '2,31p' "$0"; exit 2 ;;
esac
