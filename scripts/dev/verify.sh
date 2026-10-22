#!/bin/bash
# scripts/dev/quick.sh, plus a record of what it found in .verify/last.json:
#   {"pass": N, "fail": N, "skipped": N, "at": "<UTC>", "head": "<sha>", "skips": ["<test name>", ...]}
# fail counts failed node tests plus every other quick.sh check that failed.
# The Stop hook (scripts/dev/verify-gate.mjs) reads it: a helper cannot finish while
# the last run had a failure or a skipped test. A skip is not a pass.
# Usage: scripts/dev/verify.sh [quick.sh arguments]. Exit: quick.sh's status, or 3 when it
# passed but skipped tests.
cd "$(git rev-parse --show-toplevel)" || exit 1
OUT="${TMPDIR:-/tmp}/agsist-quick"; mkdir -p "$OUT" .verify
rm -f "$OUT/nt.out"
LOG=$(mktemp "${TMPDIR:-/tmp}/verify.XXXXXX")
bash scripts/dev/quick.sh "$@" 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
for a in "$@"; do [ "$a" = --dry-run ] && { rm -f "$LOG"; exit "$rc"; }; done
num(){ [ -f "$OUT/nt.out" ] && sed -n "s/^# $1 \([0-9][0-9]*\)$/\1/p" "$OUT/nt.out" | tail -1; }
pass=$(num pass); fail=$(num fail); skipped=$(num skipped)
other=$(grep -E '^FAIL ' "$LOG" | grep -vc '^FAIL node --test')
LOG="$LOG" NT="$OUT/nt.out" PASS="${pass:-0}" FAIL=$(( ${fail:-0} + other )) SKIPPED="${skipped:-0}" RC="$rc" HEAD_SHA="$(git rev-parse HEAD)" node -e '
  const fs = require("fs");
  const nt = fs.existsSync(process.env.NT) ? fs.readFileSync(process.env.NT, "utf8") : "";
  // TAP: "ok 3 - name # SKIP reason"
  const skips = [...nt.matchAll(/^\s*ok \d+ - (.*?) # SKIP\b(.*)$/gm)].map((m) => (m[1] + (m[2].trim() ? " (" + m[2].trim() + ")" : "")).slice(0, 200));
  let fail = +process.env.FAIL;
  if (+process.env.RC !== 0 && fail === 0) fail = 1;  // quick.sh failed in a way nothing above counted
  const rec = { pass: +process.env.PASS, fail, skipped: +process.env.SKIPPED, at: new Date().toISOString(), head: process.env.HEAD_SHA, skips: skips.slice(0, 40) };
  fs.writeFileSync(".verify/last.json", JSON.stringify(rec, null, 1) + "\n");
  console.log(`verify: pass=${rec.pass} fail=${rec.fail} skipped=${rec.skipped} (.verify/last.json)`);
  for (const s of rec.skips) console.log("  skipped: " + s);'
rm -f "$LOG"
[ "$rc" -ne 0 ] && exit "$rc"
[ "${skipped:-0}" -gt 0 ] && exit 3
exit 0
