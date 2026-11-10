#!/usr/bin/env python3
"""No AI footer in a pull request's body or its commit messages (build rule 38 and 40, Nov 4, 2026).

The platform appends a "Generated with Claude Code" footer to pull request bodies, and session lines
(Co-Authored-By: Claude, Claude-Session: and a claude.ai/code link) to commit messages, even when a
brief forbids them. A squash merge copies every commit message into main's history. On Nov 4 the body
of #316 ended with that footer, and #300 and #301 merged with it; #304 and 13 more squash merges carried
the session lines onto main. The rule was kept by hand and missed. This is its guard: the PR checks'
guard job runs it. It fails, naming each line, when the body holds one of MARKS (any case), and warns
when a commit message does: since Nov 4 the merge bot squashes with a message built from the body alone,
footer lines stripped (strip(), used by scripts/dev/merge_when_green.py), so commit messages never reach
main.

It reads the body and the commits through the API at run time (a re-run after the body is fixed sees
the fixed body; the event payload is used only when the API does not answer). Commits that cannot be
read are said in the log; the body is still checked.

    python3 scripts/dev/ai_footer_check.py              (pr-checks.yml guard job; GH_TOKEN, GITHUB_EVENT_PATH)
    python3 scripts/dev/ai_footer_check.py --selftest
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try: import _argguard; _argguard.guard(__file__)  # scripts/_argguard.py: --help and bad flags exit before any work
except ImportError: pass
sys.path.pop(0)

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
# The footer forms, anchored to the whole line (any case, the line's own leading and trailing spaces
# ignored). Nov 4, 2026, the #318 check: a bare substring match failed prose that names a form ("lines like
# `Co-Authored-By: Claude` are stripped", "Docs at https://claude.ai/code") and the squash dropped that line.
# Only the forms the platform writes match: a trailer at the start of a line, the footer sentence alone on
# its line (plain, in italics or bold, after the robot emoji), or the session link alone on its line.
MARKS = [
    ("co-authored-by: claude", re.compile(r"(?i)^co-authored-by:\s*claude\b")),
    ("claude-session:", re.compile(r"(?i)^claude-session:")),
    ("generated with/by claude code", re.compile(
        r"(?i)^(?:\U0001F916\s*)?([_*]{0,2})\s*generated (?:with|by) (?:\[claude code\]\([^)\s]*\)|claude code)\.?\s*\1$")),
    ("claude.ai/code link", re.compile(r"(?i)^<?https?://claude\.ai/code\S*?>?$")),
]
COMMIT_PAGES = 3   # 100 commits a page; GitHub lists at most 250 for a pull request
# Nov 5, 2026: the repository is public, so a body or commit message says what changed for readers.
# A long one is a warning only, never a failure.
LONG = 1200
HINT = "say what changed for readers; method goes in private notes"


def found(text):
    """[(mark, the line it is on)] for every line of text that is a footer form (MARKS)."""
    out = []
    for line in (text or "").splitlines():
        t = line.strip()
        for name, rx in MARKS:
            if rx.search(t):
                out.append((name, t[:120]))
                break
    return out


def strip(text):
    """text without its footer lines, and without the blank lines and --- rules left trailing after them
    (the merge bot's squash message, scripts/dev/merge_when_green.py squash_message)."""
    keep = [line for line in (text or "").splitlines() if not found(line)]
    while keep and (not keep[-1].strip() or re.fullmatch(r"\s*-{3,}\s*", keep[-1])):
        keep.pop()
    return "\n".join(keep)


def check(body, commits):
    """body: the PR body; commits: [(sha, message)]. -> (ok, report lines, warning lines).
    A footer in the body fails. One in a commit message is a warning: the merge bot squashes with a message
    built from the body only (merge_when_green.py squash_message), so commit messages never reach main;
    a hand merge must do the same."""
    bad = ["the pull request body: %s" % line for m, line in found(body)]
    warn = []
    for sha, msg in commits:
        for m, line in found(msg):
            warn.append("commit %s: %s" % (sha[:10], line))
    warnings = (["%d AI footer line(s) in commit messages; the merge bot's squash leaves them out (merge by hand "
                 "only with a squash message built from the body):" % len(warn)] + ["  " + w for w in warn]) if warn else []
    if not bad:
        return True, ["no AI footer in the body (%d commit message(s) read)" % len(commits)], warnings
    return False, ["%d AI footer line(s) in the pull request body; BUILD-RULES 38: strip them with the GitHub MCP "
                   "update_pull_request (a PATCH through gh api gets the footer back, rule 40), then re-run this "
                   "job:" % len(bad)] + ["  " + b for b in bad], warnings


def wording(body, commits):
    """Warning lines for a body (footer lines left out) or commit message over about LONG characters."""
    out = []
    n = len(strip(body).strip())
    if n > LONG:
        out.append("the pull request body is %d characters (over about %d): %s" % (n, LONG, HINT))
    for sha, msg in commits:
        m = len(strip(msg).strip())
        if m > LONG:
            out.append("commit %s message is %d characters (over about %d): %s" % (sha[:10], m, LONG, HINT))
    return out


def gh_get(path, token):
    req = urllib.request.Request(API + path, headers={
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-pr-checks"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        # the job's token holds contents: read only (pr-checks.yml; test/pr-checks.test.mjs keeps it so); the
        # repository is public, so a refusal of the token is retried once without it
        if token and e.code in (401, 403):
            return gh_get(path, "")
        raise


def main():
    p = os.environ.get("GITHUB_EVENT_PATH")
    ev = json.load(open(p, encoding="utf-8")) if p and os.path.isfile(p) else {}
    pr = ev.get("pull_request") or {}
    repo, n, token = os.environ.get("GITHUB_REPOSITORY"), pr.get("number"), os.environ.get("GH_TOKEN", "")
    if not (repo and n):
        print("no pull request in this run: nothing to check")
        return 0
    body = pr.get("body") or ""
    try:
        body = (gh_get("/repos/%s/pulls/%d" % (repo, n), token) or {}).get("body") or ""
    except (urllib.error.URLError, OSError, ValueError) as e:
        print("the body from the event (the API did not answer: %s)" % str(e)[:80])
    commits = []
    try:
        for page in range(1, COMMIT_PAGES + 1):
            cs = gh_get("/repos/%s/pulls/%d/commits?per_page=100&page=%d" % (repo, n, page), token) or []
            commits += [(c.get("sha") or "?", (c.get("commit") or {}).get("message") or "") for c in cs]
            if len(cs) < 100:
                break
    except (urllib.error.URLError, OSError, ValueError) as e:
        # commit lines only warn (the squash leaves them out), so unread commits are said, not failed
        print("the pull request's commits could not be read (%s); only the body was checked" % str(e)[:80])
    ok, lines, warnings = check(body, commits)
    long_lines = wording(body, commits)
    print("\n".join(lines + warnings + long_lines))
    if os.environ.get("GITHUB_ACTIONS"):
        if warnings:
            print("::warning title=AI footer in commit messages::" + warnings[0])
        for w in long_lines:
            print("::warning title=Long wording::" + w)
        if not ok:
            print("::error title=AI footer in the pull request body::" + lines[0])
    return 0 if ok else 1


# The body of #316 (Nov 4, 2026) as the platform left it, shortened, footer as appended.
REAL_316 = (
    "Fixes the PR #315 CI failure (run 41841226406, shard 6/8). In test/rp-gift.test.mjs, \"redeem: once ... "
    "a second redeem is 409 with the date\" got \"This gift is already paid for and on its way\".\n\n"
    "Deploy: the normal Workers Builds path on main.\n\n"
    "Tests:\n- node --test test/rp-gift.test.mjs: 30 pass, 0 fail, 0 skip.\n\n"
    "\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)\n\n"
    "https://claude.ai/code/session_0125s99DeDZ8Mo1rchb65eNW\n")
# #304's body, its last line as it is on GitHub (read Nov 4, 2026)
REAL_304_BODY = "_Generated by [Claude Code](https://claude.ai/code/session_0125s99DeDZ8Mo1rchb65eNW)_"
# #304's squash commit on main (fa242c9e165), its last lines
REAL_304 = (
    "* trace_reads.py answers --help (argguard); pull-rebase runs the same with no git identity or autostash "
    "config, and says why a rebase stopped\n\n"
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n"
    "Claude-Session: https://claude.ai/code/session_0125s99DeDZ8Mo1rchb65eNW\n\n---------\n\n"
    "Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>\n")


def selftest():
    fails = []

    def ck(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)

    ok, lines, warns = check(REAL_316, [("26cc73685438ab71f7c81ceea7ab23f04fa055c0", "Gift cards: store prepaid on every card")])
    ck(not ok and len(lines) == 3 and "the pull request body: \U0001F916 Generated with [Claude Code]" in lines[1]
       and "claude.ai/code/session_" in lines[2] and not warns, "#316's body fails, both footer lines named")
    ok, lines, warns = check("Plain body.", [("fa242c9e1657c2237e2801d50c6b43a70cefb717", REAL_304)])
    ck(ok and len(warns) == 4 and all("commit fa242c9e16" in w for w in warns[1:]),
       "#304's squash message in a commit warns on its 3 lines; the body passes")
    ck(not check(REAL_304_BODY, [])[0], "#304's body line fails")
    ck(check(REAL_316.split("\U0001F916")[0], [("a" * 40, "Basis sparklines: a change row with no state")])[0],
       "#316's body with the footer stripped passes")
    for t in ("Generated by Claude Code", "GENERATED BY [CLAUDE CODE](x)", "co-authored-by: claude <x>",
              "claude-session: x", "https://Claude.AI/code/session_x", "  _Generated with [Claude Code](https://claude.com/claude-code)_  ",
              "\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)", "**Generated by Claude Code**",
              "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"):
        ck(not check(t, [])[0], "a footer form, any case: %r" % t)
    # prose that names a form is not a footer (the #318 check's two cases), nor is a quoted or indented-in-prose form
    for t in ("Claude Monet painted it", "Co-authored-by: Sig <s@x>", "the claude-code skill", "generated pages",
              "lines like `Co-Authored-By: Claude` are stripped", "Docs at https://claude.ai/code",
              "- the bot drops a line Generated with [Claude Code](x) from the body", "> claude-session lines go",
              "Co-Authored-By: Claudette <c@x>", "this was generated by claude code review, then edited"):
        r = check(t, [("b" * 40, t)])
        ck(r[0] and not r[2], "not a footer: %r" % t)
    ck(found(None) == [] and check("", [])[0], "an empty body and no commits pass")
    ck(strip(REAL_316) == REAL_316.split("\n\n\U0001F916")[0], "strip: #316's body loses its footer and the blank lines before it")
    ck(strip(REAL_304) == REAL_304.split("\n\nCo-Authored-By")[0], "strip: #304's lines and the --- rule between them go")
    ck(strip("a\n\nb\n") == "a\n\nb" and strip("") == "" and strip(None) == "", "strip keeps a clean text")
    # wording: a long body or commit message warns (never fails); the footer does not count toward the length
    long_body = "Fixes the town page. " * 70
    ck(len(long_body) > LONG and check(long_body, [])[0] and len(wording(long_body, [])) == 1
       and HINT in wording(long_body, [])[0], "a body over about 1,200 characters warns and still passes")
    ck(wording("Fixes the town page.", [("c" * 40, "Town page fix")]) == [], "a short body and commit message do not warn")
    edge = "x" * LONG
    ck(wording(edge + "\n\n\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)\n", []) == [],
       "the footer does not count toward the length")
    w = wording("Short.", [("d" * 40, long_body)])
    ck(len(w) == 1 and w[0].startswith("commit dddddddddd message is"), "a long commit message warns by its sha")
    print("\n%d failed" % len(fails) if fails else "\nall ai_footer_check checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else main())
