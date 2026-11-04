#!/bin/bash
# agsist_data.sh: copy folders of this checkout to the public repo dnilgis/agsist-data, at the same paths,
# and push (Nov 4, 2026; scripts/share_host.py says why and in what order).
#
#   bash scripts/agsist_data.sh sync [--soft] FOLDER...
#
# Each try: a fresh depth-1 clone of agsist-data, each FOLDER replaced by this checkout's copy (files gone
# here are removed there), one commit as the bot when anything changed, push. Only changed files make new
# blobs, so the repo grows by what really changed. A rejected push (another job pushed first) starts the try
# again from a fresh clone; never forced. Jobs write disjoint folders, so a retry always lands.
#
# AGSIST_DATA_TOKEN (fine-grained, contents read and write on agsist-data only) is sent as a header, never
# in a URL or a file. AGSIST_DATA_REPO overrides the repo (owner/name), AGSIST_DATA_REMOTE the whole remote
# (a local path, for the tests; no token then).
#
# --soft: a failure exits 0 with a warning while no FOLDER is listed in data/share-host.json (the pages
# still name agsist.com). Once a folder is listed, the pages name agsist-data and a failure exits 1 so the
# caller does not commit pages that point at a card that is not there.
_g="$(dirname "${BASH_SOURCE[0]}")/_argguard.sh"; [ -f "$_g" ] && { . "$_g"; argguard "${BASH_SOURCE[0]}" "$@"; }
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cmd="${1:-}"; shift || true
[ "$cmd" = sync ] || { echo "usage: agsist_data.sh sync [--soft] FOLDER..." >&2; exit 2; }
SOFT=0; folders=()
for a in "$@"; do case "$a" in --soft) SOFT=1 ;; *) folders+=("${a%/}") ;; esac; done
[ ${#folders[@]} -gt 0 ] || { echo "agsist_data: name at least one folder" >&2; exit 2; }
for f in "${folders[@]}"; do
  case "$f" in /*|*..*|.git*|'') echo "agsist_data: bad folder $f" >&2; exit 2 ;; esac
done

REPO="${AGSIST_DATA_REPO:-dnilgis/agsist-data}"
REMOTE="${AGSIST_DATA_REMOTE:-https://github.com/$REPO.git}"
TRIES="${AGSIST_DATA_TRIES:-4}"

give_up() {
  local why="$1"
  if [ "$SOFT" = 1 ]; then
    local listed
    listed=$(python3 "$ROOT/scripts/share_host.py" --root "$ROOT" seeded 2>/dev/null || echo "?")
    local hit=0
    for f in "${folders[@]}"; do case " $listed " in *" $f "*|*" ? "*) hit=1 ;; esac; done
    if [ "$hit" = 0 ]; then
      echo "::warning::agsist-data not updated ($why); the pages still name agsist.com, so nothing breaks"
      exit 0
    fi
  fi
  echo "::error::agsist-data not updated: $why"
  exit 1
}

if [ -z "${AGSIST_DATA_REMOTE:-}" ]; then
  [ -n "${AGSIST_DATA_TOKEN:-}" ] || give_up "AGSIST_DATA_TOKEN is not set"
  auth=$(printf 'x-access-token:%s' "$AGSIST_DATA_TOKEN" | base64 -w0)
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$auth"
  # git reads these for every command in this script; nothing is written to a config file
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth"
  unset auth
fi
export GIT_TERMINAL_PROMPT=0

for f in "${folders[@]}"; do
  [ -d "$ROOT/$f" ] || give_up "$f is not a folder in this checkout"
done

sha=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "?")
base="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
for i in $(seq 1 "$TRIES"); do
  dir=$(mktemp -d "$base/agsist-data.XXXXXX")
  if ! git clone -q --depth 1 --branch main "$REMOTE" "$dir/r" 2>"$dir/err"; then
    echo "try $i: clone failed: $(head -c 300 "$dir/err" | tr '\n' ' ')"
    rm -rf "$dir"; [ "$i" -lt "$TRIES" ] && sleep $((15 * i)); continue
  fi
  for f in "${folders[@]}"; do
    rm -rf "${dir:?}/r/$f"; mkdir -p "$dir/r/$f"
    cp -a "$ROOT/$f/." "$dir/r/$f/"
  done
  # GitHub Pages serves the files as they are (no Jekyll pass)
  [ -f "$dir/r/.nojekyll" ] || : > "$dir/r/.nojekyll"
  git -C "$dir/r" add -A -- "${folders[@]}" .nojekyll
  if git -C "$dir/r" diff --cached --quiet; then
    echo "agsist-data: ${folders[*]} already up to date"; rm -rf "$dir"; exit 0
  fi
  n=$(git -C "$dir/r" diff --cached --name-only | wc -l)
  git -C "$dir/r" -c user.name="AGSIST Bot" -c user.email="bot@agsist.com" \
    commit -q -m "${folders[*]}: from agsist $sha ($n files)"
  if git -C "$dir/r" push -q origin HEAD:main 2>"$dir/err"; then
    echo "agsist-data: pushed $n changed files in ${folders[*]} (try $i)"; rm -rf "$dir"; exit 0
  fi
  echo "try $i: push rejected: $(head -c 300 "$dir/err" | tr '\n' ' ')"
  rm -rf "$dir"; [ "$i" -lt "$TRIES" ] && sleep $((15 * i))
done
give_up "push failed after $TRIES tries"
