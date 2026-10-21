#!/bin/bash
# Quick checks while building: only the tests related to what changed, plus a fast core.
# Not a ship check. Before merging, open the PR and wait for pr-checks ("all checks") to go green;
# run the full scripts/dev/checks.sh locally only if CI is unavailable.
#
# Usage: scripts/dev/quick.sh [--dry-run] [file ...]
#   no files: git diff --name-only origin/main...HEAD, plus uncommitted and untracked files
#   (QUICK_BASE=<ref> to compare against something other than origin/main)
#   --dry-run   print what would run and why, run nothing
#
# What it picks, and prints why:
#   core       test/engine, ses-ready, email-links; checks.sh --only=nav
#   reference  every test file whose text names a changed path or its basename
#   changed    a changed test file itself
#   selftest   python3 scripts/X.py --selftest for each changed scripts/*.py that has --selftest
#   check      a checks.sh line whose command names a changed script (checks.sh --only=<name>)
#   worker     node scripts/test_form_worker.mjs when workers/subs-worker.js changes
cd "$(git rev-parse --show-toplevel)" || exit 1
DRY=0; files=()
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,18p' "$0"; exit 0 ;; *) files+=("$a") ;; esac; done
BASE="${QUICK_BASE:-origin/main}"
if [ ${#files[@]} -eq 0 ]; then
  mapfile -t files < <({ git diff --name-only "$BASE"...HEAD 2>/dev/null; git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
fi
[ ${#files[@]} -gt 0 ] || echo "quick: nothing changed against $BASE; running the core only"

declare -A why; order=()
add(){ [ -n "${why[$1]+x}" ] || order+=("$1"); why[$1]="${why[$1]:+${why[$1]}; }$2"; }
for t in test/engine.test.mjs test/ses-ready.test.mjs test/email-links.test.mjs; do [ -f "$t" ] && add "test:$t" core; done
add "check:nav" core

mapfile -t TESTS < <(find test -name '*.test.mjs' -not -path '*/node_modules/*' | sort)
for p in "${files[@]}"; do
  b=$(basename "$p")
  case "$p" in test/*.test.mjs) [ -f "$p" ] && add "test:$p" "changed" ;; esac
  # test files that name the changed path or its basename
  while IFS= read -r t; do [ "$t" = "$p" ] || add "test:$t" "names $b"; done < <(grep -lF -e "$p" -e "$b" -- "${TESTS[@]}" 2>/dev/null)
  case "$p" in
    scripts/*.py) [ -f "$p" ] && grep -q -- '--selftest' "$p" && add "py:$p" "changed, has --selftest" ;;
    workers/subs-worker.js) add "worker" "workers/subs-worker.js changed" ;;
  esac
  # a checks.sh line whose own command names the changed script
  case "$p" in scripts/*)
    while IFS= read -r n; do add "check:$n" "checks.sh line runs $b"; done < <(grep -E '^run [A-Za-z0-9_.-]+ ' scripts/dev/checks.sh | grep -F -- "$p" | awk '{print $2}') ;;
  esac
done

nt=(); other=()
for k in "${order[@]}"; do case "$k" in test:*) nt+=("${k#test:}") ;; *) other+=("$k") ;; esac; done
echo "quick: ${#files[@]} changed file(s) against $BASE; ${#nt[@]} test file(s), ${#other[@]} other check(s)"
for k in "${order[@]}"; do printf '  %-48s %s\n' "${k#*:}" "${why[$k]}"; done
[ "$DRY" = 1 ] && exit 0

fails=0; t0=$SECONDS
OUT="${TMPDIR:-/tmp}/agsist-quick"; mkdir -p "$OUT"
# Chromium keeps a socket in its profile under TMPDIR; a long TMPDIR path makes the launch hang until the test times out
[ ${#OUT} -gt 60 ] && echo "quick: warning: TMPDIR is long (${#OUT} chars); browser tests may hang. Use a short one, e.g. TMPDIR=/tmp/x/q"
step(){ local name="$1"; shift; local s=$SECONDS out rc; out=$("$@" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then echo "FAIL $name ($((SECONDS-s))s)"; echo "$out" | tail -40; fails=$((fails+1)); else echo "ok   $name ($((SECONDS-s))s)"; fi; }
if [ ${#nt[@]} -gt 0 ]; then
  step "node --test (${#nt[@]} files)" bash -c 'node --test "$@" > "'"$OUT"'/nt.out" 2>&1; rc=$?; grep -E "^# (pass|fail|skipped)" "'"$OUT"'/nt.out"; [ $rc -eq 0 ] || { grep -B2 -A15 -E "^\s*not ok" "'"$OUT"'/nt.out" | head -60; exit 1; }' _ "${nt[@]}"
  grep -E '^# (pass|fail|skipped) ' "$OUT/nt.out" | tr '\n' ' '; echo
fi
for k in "${other[@]}"; do
  case "$k" in
    py:*) step "${k#py:} --selftest" python3 "${k#py:}" --selftest ;;
    worker) step "test_form_worker" node scripts/test_form_worker.mjs ;;
    check:*) step "checks.sh --only=${k#check:}" bash scripts/dev/checks.sh --only="${k#check:}" ;;
  esac
done
echo "QUICK FAILS=$fails in $((SECONDS-t0))s (not a ship check: open the PR and wait for pr-checks)"
[ "$fails" -eq 0 ]
