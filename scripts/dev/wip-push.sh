#!/bin/bash
# WIP autosave (BUILD-RULES 18: local-only work is not work). Run by the Stop and
# SubagentStop hooks in .claude/settings.json (async, so it never holds up a turn).
#
# For the session's checkout and every worktree of it that is on an fx/* branch:
#   stage tracked changes, plus new files under the normal source folders,
#   commit "WIP autosave" as dnilgis, push to origin HEAD (never forced).
# Never main or any other branch. Never .env, keys, tokens, node_modules,
# scratch, or a file over 5 MB; a staged file like that stops the save for that
# checkout. Nothing changed: no commit, no output. Always exits 0.
#
# Input: the hook's JSON on stdin (only "cwd" is read). CLAUDE_PROJECT_DIR is the
# fallback. WIP_MAX_BYTES overrides the 5 MB cap (tests).
exec 2>/dev/null
trap 'exit 0' EXIT
IN=$(timeout 5 cat 2>/dev/null)
MAX="${WIP_MAX_BYTES:-5242880}"
NAME=dnilgis; MAIL=dnilgis@gmail.com
# new (untracked) files are only picked up under these, or as a top-level page or script
SRC_DIRS=(components scripts workers test css js img fonts embed .github .claude/agents)

cwd=$(printf '%s' "$IN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).cwd||""))}catch(e){}})' 2>/dev/null)

roots=()
for d in "$cwd" "$CLAUDE_PROJECT_DIR"; do
  [ -n "$d" ] && [ -d "$d" ] || continue
  t=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) || continue
  roots+=("$t")
  # every worktree of that repo (helpers build in their own under <scratchpad>/wt/)
  while IFS= read -r w; do [ -d "$w" ] && roots+=("$w"); done < <(git -C "$t" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
done

bad_name(){ # path -> 0 when it must never be committed
  local p="$1" b; b=$(basename "$p")
  case "/$p/" in */node_modules/*|*/scratch/*|*/scratchpad/*|*/.verify/*|*/tmp/*) return 0 ;; esac
  case "$b" in
    .env|.env.*|*.env|.envrc|.dev.vars|.netrc|.npmrc|.pypirc) return 0 ;;
    *.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*.gpg|*.asc|id_rsa*|id_ed25519*|id_ecdsa*) return 0 ;;
    *secret*|*Secret*|*SECRET*|*credential*|*Credential*|*token*.json|*.tfvars) return 0 ;;
  esac
  return 1
}
bad_file(){ # path (exists) -> 0 when too big or it carries a key
  local p="$1" n
  [ -f "$p" ] || return 1
  n=$(stat -c %s -- "$p" 2>/dev/null || echo 0)
  [ "$n" -gt "$MAX" ] && return 0
  # the shapes of real keys; the match is never printed
  grep -qE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsk_live_[A-Za-z0-9]{20,}|\brk_live_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b' -- "$p" && return 0
  return 1
}

save(){ # one checkout
  local r="$1" br gd f add=() p
  cd "$r" || return
  br=$(git symbolic-ref -q --short HEAD) || return        # detached: no
  case "$br" in fx/*) ;; *) return ;; esac                 # main or anything else: no
  gd=$(git rev-parse --absolute-git-dir) || return
  for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply BISECT_LOG; do [ -e "$gd/$f" ] && return; done
  exec 9>"$gd/wip-autosave.lock"; flock -n 9 || return    # another save is running here

  # something the helper already staged that must not go out: leave this checkout alone
  while IFS= read -r -d '' p; do
    { bad_name "$p" || bad_file "$p"; } && return
  done < <(git diff --cached --name-only -z --diff-filter=ACMR)

  # tracked files (changed or deleted)
  while IFS= read -r -d '' p; do
    if [ -e "$p" ]; then { bad_name "$p" || bad_file "$p"; } && continue; fi
    add+=("$p")
  done < <(git diff --name-only -z)
  # new files under the source folders, and new top-level pages and scripts (.gitignore applies)
  while IFS= read -r -d '' p; do
    case "$p" in */*) ;; *.html|*.js|*.mjs|*.css) ;; *) continue ;; esac
    { bad_name "$p" || bad_file "$p"; } && continue
    add+=("$p")
  done < <(git ls-files --others --exclude-standard -z -- "${SRC_DIRS[@]}" ':(glob)*.html' ':(glob)*.js' ':(glob)*.mjs' ':(glob)*.css')

  [ ${#add[@]} -gt 0 ] && git add -A -- "${add[@]}" >/dev/null
  git diff --cached --quiet && return                       # nothing to save
  git -c user.name="$NAME" -c user.email="$MAIL" commit -q -m "WIP autosave" >/dev/null || return
  # not forced, ever: a branch that moved on the remote is left for the helper to merge
  timeout 60 git push -q origin HEAD >/dev/null 2>&1
}

declare -A done_
for r in "${roots[@]}"; do
  r=$(cd "$r" 2>/dev/null && pwd -P) || continue
  [ -n "${done_[$r]+x}" ] && continue; done_[$r]=1
  ( save "$r" )
done
exit 0
