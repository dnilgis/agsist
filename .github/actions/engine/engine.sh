#!/bin/bash
# The engine: the collection code (paths in .github/engine-paths) lives on a
# branch of the private repo and is copied into the checkout before it runs.
#
# In Actions (the "Engine checkout" step, .github/actions/engine/action.yml):
#   engine.sh plan              decide in-repo or private (MODE, HAVE_TOKEN), write step outputs
#   engine.sh overlay <dir>     copy the engine paths from <dir> (the private checkout) into place
# In a local session (from anywhere inside the checkout):
#   engine.sh pull              clone or update the engine next to this checkout
#                               (ENGINE_DIR, default ../<repo>-engine) and copy it in
#   engine.sh save [message]    copy this checkout's engine paths back into ENGINE_DIR and
#                               commit there (it does not push; it prints the push line)
#
# Rules:
# - While this repository still tracks a path, the copy never overwrites a
#   tracked file: the checkout stays clean, so a job's `git pull --rebase`
#   cannot stop on a code file. Once the code is gone from this repository the
#   engine copy is the only copy.
# - Every engine path (and the scratch checkout) goes into .git/info/exclude,
#   so a job's bare `git add -A` can never put private code in this repository.
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

# copy <src> into the checkout, path by path
overlay_from() {
  local src="$1" p kept=0 n
  for p in "${PATHS[@]}"; do
    [ -e "$src/$p" ] || say_fail "the engine branch $BRANCH has no $p"
  done
  exclude_paths
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
  plan)
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
    if [ -d "$ED/.git" ]; then
      git -C "$ED" fetch -q origin "$BRANCH" && git -C "$ED" merge -q --ff-only "origin/$BRANCH" || { echo "engine: could not update $ED" >&2; exit 1; }
    else
      git clone -q -b "$BRANCH" "${ENGINE_REMOTE:-https://github.com/$REPO.git}" "$ED" || { echo "engine: could not clone $REPO $BRANCH into $ED" >&2; exit 1; }
    fi
    overlay_from "$ED"
    echo "engine: $(git -C "$ED" rev-parse --short HEAD) from $ED copied into $ROOT (${PATHS[*]})" ;;
  save)
    ED="${ENGINE_DIR:-$(dirname "$ROOT")/$(basename "$ROOT")-engine}"
    [ -d "$ED/.git" ] || { echo "engine: no engine clone at $ED (run engine.sh pull first)" >&2; exit 1; }
    for p in "${PATHS[@]}"; do
      [ -e "$ROOT/$p" ] || { echo "engine: $ROOT/$p is missing; nothing saved" >&2; exit 1; }
    done
    for p in "${PATHS[@]}"; do rm -rf "${ED:?}/$p"; cp -a "$ROOT/$p" "$ED/$p"; done
    git -C "$ED" add -A -- "${PATHS[@]}"
    if git -C "$ED" diff --cached --quiet; then echo "engine: nothing to save"; exit 0; fi
    git -C "$ED" -c user.name="${GIT_AUTHOR_NAME:-dnilgis}" -c user.email="${GIT_AUTHOR_EMAIL:-dnilgis@gmail.com}" \
      commit -q -m "${1:-engine: from $(basename "$ROOT") $(git -C "$ROOT" rev-parse --short HEAD)}" || exit 1
    git -C "$ED" show --stat --format='engine: committed %h %s' HEAD | tail -n +1 | head -20
    echo "push it: git -C $ED push origin $BRANCH" ;;
  *)
    sed -n '2,22p' "$0"; exit 2 ;;
esac
