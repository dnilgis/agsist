# Where the private branches live (raw, references, private-data). Sourced, not run:
#   . scripts/private_remote.sh
#
# Since Oct 20, 2026 they are in the private repo dnilgis/agsistretired, not on
# agsist (Sig: off the public repo). Pages read only public files on main, so
# nothing here touches the site. Picks, in order:
#   RAW_REMOTE set          that remote (tests, or a local run against a clone:
#                           RAW_REMOTE=../agsistretired)
#   PRIVATE_REPO_TOKEN set  the private repo, with that token (Actions; the
#                           secret is fine-grained, Contents read/write on
#                           agsistretired only)
#   neither                 origin (the old branches on agsist, for local runs
#                           until they are deleted)
# Sets REMOTE (what git is given), WHERE (what a message may print; never the
# token) and hide (a filter that blanks a token out of git's output).
#
# actions/checkout leaves its own token in http.https://github.com/.extraheader,
# and git would send that one instead of ours (the private repo then answers
# "not found"). An empty value resets that list for these git calls only.
PRIVATE_REPO=dnilgis/agsistretired
if [ -n "${RAW_REMOTE:-}" ]; then
  REMOTE="$RAW_REMOTE"; WHERE="$RAW_REMOTE"
elif [ -n "${PRIVATE_REPO_TOKEN:-}" ]; then
  REMOTE="https://x-access-token:${PRIVATE_REPO_TOKEN}@github.com/${PRIVATE_REPO}.git"
  WHERE="the private repo ($PRIVATE_REPO)"
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_0=''
  export GIT_TERMINAL_PROMPT=0
else
  REMOTE=origin; WHERE=origin
fi
hide() {
  if [ -n "${PRIVATE_REPO_TOKEN:-}" ]; then
    sed -E -e 's#x-access-token:[^@]*@#x-access-token:***@#g' -e "s#${PRIVATE_REPO_TOKEN//#/}#***#g"
  else
    sed -E 's#x-access-token:[^@]*@#x-access-token:***@#g'
  fi
}
