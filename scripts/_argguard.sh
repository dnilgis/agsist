# Shared guard so a script never does work when asked for --help.
# A script runs, right after its leading comment (fail soft when this file is not beside it):
#   _g="$(dirname "${BASH_SOURCE[0]}")/_argguard.sh"; [ -f "$_g" ] && { . "$_g"; argguard "${BASH_SOURCE[0]}" "$@"; }
#   -h / --help   print the leading comment block and exit 0.
#   unknown flag  a dash argument that does not appear quoted or after a case label in the
#                 script's own source exits 2 with one short line.
# Real arguments are untouched; positional arguments are never checked.
argguard() {
  local self="$1"; shift
  [ "${BASH_SOURCE[1]:-}" = "$0" ] || return 0   # sourced by another script
  local a flags=() name; name=$(basename "$self")
  for a in "$@"; do
    case "$a" in -[A-Za-z]*|--[A-Za-z]*) flags+=("$a");; esac
  done
  [ "${#flags[@]}" -gt 0 ] || return 0
  for a in "${flags[@]}"; do
    case "$a" in
      -h|--help)
        echo "usage: $name [-h]"; echo
        awk 'NR==1&&/^#!/{next} /^#/{sub(/^# ?/,"");print;n++;next} n||NF{exit}' "$self" | head -40
        exit 0;;
    esac
  done
  local files=("$self") o   # ARGGUARD_ALSO: sibling scripts this one forwards its arguments to
  for o in ${ARGGUARD_ALSO:-}; do files+=("$(dirname "$self")/$o"); done
  for a in "${flags[@]}"; do
    a=${a%%=*}
    grep -qE -- "(^|[^A-Za-z0-9_-])${a}([^A-Za-z0-9_-]|\$)" <(grep -hv '_argguard\|^[[:space:]]*#' "${files[@]}") || { echo "$name: unknown option $a (try --help)" >&2; exit 2; }
  done
}
