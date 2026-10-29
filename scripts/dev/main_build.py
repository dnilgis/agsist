#!/usr/bin/env python3
"""Files built on main, never edited in a pull request (Sig, Oct 29, 2026: no generated-file conflicts).

Every pull request used to rebuild these, so nearly every merge conflicted in them. Now a pull
request changes only the inputs (an entry file in data/whats-new/, data/changelog.json, tests,
pages); main-checks.yml runs `build` on every push to main and commits the result, and the PR
checks run `build` in their own copy before the tests, so the tests see what main will serve.

  python3 scripts/dev/main_build.py build              write every built file
  python3 scripts/dev/main_build.py check              fail if any built file is stale
  python3 scripts/dev/main_build.py guard [--base REF] fail if this branch edits a built block by hand
                                                       (git diff against the merge base with REF,
                                                       default origin/main; on main itself it passes)
  python3 scripts/dev/main_build.py validate           the inputs are valid (entries, changelog data)
  python3 scripts/dev/main_build.py paths              print the built files
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# in build order; each takes --check
BUILDERS = [
    ["scripts/build_changelog.py"],
    ["scripts/build_whats_new.py"],
    ["scripts/dev/test_map.py"],
]
# built file -> the blocks in it that the builders own (None: the whole file)
BUILT = {
    "data/whats-new.json": None,
    "scripts/dev/test-map.json": None,
    "index.html": [r"<!-- WHATSNEW:link.*?<!-- /WHATSNEW:link -->"],
    "changelog.html": [
        r"<!-- WHATSNEW:entries -->.*?<!-- /WHATSNEW:entries -->",
        r"<!-- CHANGELOG:entries -->.*?<!-- /CHANGELOG:entries -->",
        r"<!-- CHANGELOG:stamp -->.*?<!-- /CHANGELOG:stamp -->",
        r'"dateModified":"[^"]*"',
    ],
}
VALIDATE = [
    ["scripts/build_whats_new.py", "--validate"],
    ["scripts/build_changelog.py", "--validate"],
]


def run(cmd):
    r = subprocess.run([sys.executable] + cmd, cwd=ROOT, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def blocks(text, path):
    """the builder-owned parts of one version of a built file (None when the file is absent)"""
    if text is None:
        return None
    pats = BUILT[path]
    if pats is None:
        return [text]
    return [m for p in pats for m in re.findall(p, text, flags=re.S)]


def git_show(ref, path):
    r = subprocess.run(["git", "-C", ROOT, "show", "%s:%s" % (ref, path)], capture_output=True)
    return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else None


def guard(base_ref):
    mb = subprocess.run(["git", "-C", ROOT, "merge-base", base_ref, "HEAD"], capture_output=True, text=True)
    if mb.returncode != 0:
        print("guard: no merge base with %s (fetch it: git fetch origin main)" % base_ref)
        return 1
    base = mb.stdout.strip()
    bad = []
    for path in BUILT:
        a, b = blocks(git_show(base, path), path), blocks(git_show("HEAD", path), path)
        if a != b:
            bad.append(path)
    if bad:
        print("guard: this branch edits files that are built on main: " + ", ".join(bad))
        print("  Put back main's copy (git checkout origin/main -- <file>, or for index.html and changelog.html")
        print("  only the generated blocks) and change the inputs instead: an entry file in data/whats-new/,")
        print("  data/changelog.json. main-checks.yml rebuilds them after the merge.")
        return 1
    print("guard: no built file edited by hand (against %s)" % base[:12])
    return 0


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "paths":
        print("\n".join(BUILT))
        return 0
    if cmd == "build":
        for b in BUILDERS:
            rc, out = run(b)
            print(out)
            if rc:
                print("build: %s failed" % " ".join(b))
                return 1
        return 0
    if cmd == "check":
        fails = 0
        for b in BUILDERS:
            rc, out = run(b + ["--check"])
            print(out)
            fails += rc != 0
        return 1 if fails else 0
    if cmd == "validate":
        fails = 0
        for v in VALIDATE:
            rc, out = run(v)
            print(out)
            fails += rc != 0
        return 1 if fails else 0
    if cmd == "guard":
        base = argv[argv.index("--base") + 1] if "--base" in argv else os.environ.get("CHECK_BASE", "origin/main")
        return guard(base)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
