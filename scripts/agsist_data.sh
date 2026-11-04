#!/bin/bash
# agsist_data.sh: the share images live in the public repo dnilgis/agsist-data, served at
# https://dnilgis.github.io/agsist-data/ at the same paths (Nov 4, 2026; scripts/share_host.py). This keeps
# that repo in step with the jobs that draw them.
#
#   bash scripts/agsist_data.sh checkout DIR
#       a depth-1 clone of agsist-data in DIR, so a builder can draw into it (the Atlas cards: its
#       stamps.json says which cards are already drawn). Fails after the tries.
#   bash scripts/agsist_data.sh sync [--soft] [--from DIR] [--keep] FOLDER...
#       each FOLDER of DIR (default: this checkout) goes to agsist-data at the same path, and is pushed.
#       Default: the folder there becomes a copy of DIR's (files gone from DIR are removed there); a
#       source folder with under half the files the folder there has is refused, so a broken run never
#       empties it. --keep: the files are added or replaced, nothing is removed (the Daily adds one card).
#
# Each try: a fresh depth-1 clone, the copy, one commit as the bot when anything changed, push. Only
# changed files make new blobs. A rejected push (another job pushed first) starts the try again from a
# fresh clone; never forced. Jobs write disjoint folders, so a retry always lands.
#
# AGSIST_DATA_TOKEN (fine-grained, contents read and write on agsist-data only) is sent as a header, never
# in a URL or a file. AGSIST_DATA_TRIES sets the tries (4). AGSIST_DATA_REPO overrides the repo
# (owner/name), AGSIST_DATA_REMOTE the whole remote (a local path, for the tests; no token then).
#
# --soft: a failure exits 0 with a warning while no FOLDER is listed in data/share-host.json (the pages
# still name agsist.com). Once a folder is listed a failure exits 1.
_g="$(dirname "${BASH_SOURCE[0]}")/_argguard.sh"; [ -f "$_g" ] && { . "$_g"; argguard "${BASH_SOURCE[0]}" "$@"; }
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cmd="${1:-}"; shift || true
case "$cmd" in sync|checkout) ;; *) echo "usage: agsist_data.sh sync [--soft] [--from DIR] [--keep] FOLDER... | checkout DIR" >&2; exit 2 ;; esac
SOFT=0; KEEP=0; SRC="$ROOT"; folders=(); want_from=0
for a in "$@"; do
  if [ "$want_from" = 1 ]; then SRC="${a%/}"; want_from=0; continue; fi
  case "$a" in --soft) SOFT=1 ;; --keep) KEEP=1 ;; --from) want_from=1 ;; *) folders+=("${a%/}") ;; esac
done
if [ "$cmd" = checkout ]; then
  [ ${#folders[@]} -eq 1 ] || { echo "agsist_data: checkout DIR" >&2; exit 2; }
  OUT="${folders[0]}"; folders=()
else
  [ ${#folders[@]} -gt 0 ] || { echo "agsist_data: name at least one folder" >&2; exit 2; }
fi
for f in ${folders[@]+"${folders[@]}"}; do
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
    for f in ${folders[@]+"${folders[@]}"}; do case " $listed " in *" $f "*|*" ? "*) hit=1 ;; esac; done
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

if [ "$cmd" = checkout ]; then
  [ -e "$OUT" ] && { echo "agsist_data: $OUT exists" >&2; exit 2; }
  for i in $(seq 1 "$TRIES"); do
    if git clone -q --depth 1 --branch main "$REMOTE" "$OUT" 2>"$OUT.err"; then
      rm -f "$OUT.err"; echo "agsist-data: checked out in $OUT (try $i)"; exit 0
    fi
    echo "try $i: clone failed: $(head -c 300 "$OUT.err" | tr '\n' ' ')"
    rm -rf "$OUT"; [ "$i" -lt "$TRIES" ] && sleep $((15 * i))
  done
  rm -f "$OUT.err"
  give_up "clone failed after $TRIES tries"
fi

for f in "${folders[@]}"; do
  [ -d "$SRC/$f" ] || give_up "$f is not a folder in $SRC"
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
    if [ "$KEEP" = 0 ]; then
      have=$(find "$dir/r/$f" -type f 2>/dev/null | wc -l); got=$(find "$SRC/$f" -type f | wc -l)
      if [ "$got" -lt $((have / 2)) ]; then
        rm -rf "$dir"; give_up "$SRC/$f has $got files and agsist-data has $have: refusing to remove more than half"
      fi
      rm -rf "${dir:?}/r/$f"
    fi
    mkdir -p "$dir/r/$f"
    cp -a "$SRC/$f/." "$dir/r/$f/"
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
