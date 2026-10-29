#!/usr/bin/env python3
"""What a publish-only-the-site Pages deploy would publish. A plan, not switched on.

Today Pages deploys the main branch as-is (.nojekyll), so scripts/, test/ and
the other folders in check_site_budget.NOT_READER_FACING are served and count
toward the 1 GB limit although no reader loads them. A Pages deploy from a
filtered artifact (actions/deploy-pages) would leave them out. This script is
that filter, and its dry run:

  python3 scripts/pages_publish.py                     # dry run on the working tree
  python3 scripts/pages_publish.py --tree origin/main  # dry run on a commit (sparse checkouts too)
  python3 scripts/pages_publish.py --stage _site       # copy the publish set into _site (the workflow)
  python3 scripts/pages_publish.py --selftest

The dry run prints the bytes kept and left out and fails (exit 1) when a
reader-facing file links to something the filter would leave out: a page that
loads /scripts/x.js would break the day the deploy switched. The workflow runs
the same check before it uploads, so a broken link stops the deploy instead of
reaching readers. The plan and the workflow are in feedbag
notes/panels/godseye-2026-10-26/size-trim-plan.md.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_site_budget as budget  # noqa: E402

ROOT = budget.ROOT
# Pages needs these although they start with a dot or sit at the root.
KEEP_ALWAYS = (".well-known/", ".nojekyll", "CNAME")


def _excluded_names():
    folders = [p.rstrip("/") for p in budget.NOT_READER_FACING if p.endswith("/") and "/" not in p.rstrip("/")]
    data = [p for p in budget.NOT_READER_FACING if p.startswith("data/")]
    files = [p for p in budget.NOT_READER_FACING if "/" not in p]
    return folders, data, files


def link_pattern():
    """A regex for a link, src, fetch or import that points into a left-out path."""
    folders, data, files = _excluded_names()
    alts = [re.escape(f) + "/" for f in folders] + [re.escape(d) for d in data] + [re.escape(f) + r"\b" for f in files]
    target = r"(?:https?://(?:www\.)?agsist\.com)?/?(?:" + "|".join(alts) + ")"
    return (r"(?:\b(?:href|src|action|data-src|poster)\s*=\s*[\"']" + target +
            r"|\b(?:fetch|import)\s*\(\s*[\"'`]" + target +
            r"|\burl\(\s*[\"']?" + target + ")")


def absolute_pattern():
    """A full agsist.com URL into a left-out path, in any file: a worker, an
    email template or a script that fetches the live site would break too."""
    folders, data, files = _excluded_names()
    alts = [re.escape(f) + "/" for f in folders] + [re.escape(d) for d in data] + [re.escape(f) + r"\b" for f in files]
    return r"\bagsist\.com/(?:" + "|".join(alts) + ")"


def publishes(rel):
    """True when the filtered artifact keeps rel (a path with /)."""
    rel = rel.replace(os.sep, "/")
    if rel.startswith(KEEP_ALWAYS) or rel in KEEP_ALWAYS:
        return True
    parts = rel.split("/")
    if any(d in budget.SKIP_DIRS or d.startswith(".") for d in parts[:-1]):
        return False
    return budget.reader_facing(rel)


def tracked(root, rev=None):
    """(path, bytes) for every committed file: from rev's tree, or the index."""
    if rev:
        out = subprocess.run(["git", "-C", root, "ls-tree", "-r", "-l", "-z", rev], capture_output=True, timeout=300)
        if out.returncode != 0:
            raise RuntimeError(f"git ls-tree {rev} failed: {out.stderr.decode('utf-8', 'replace').strip()}")
        for rec in out.stdout.decode("utf-8", "replace").split("\0"):
            if "\t" not in rec:
                continue
            meta, path = rec.split("\t", 1)
            m = meta.split()
            if len(m) >= 4 and m[1] == "blob" and m[3] != "-":
                yield path, int(m[3])
        return
    out = subprocess.run(["git", "-C", root, "ls-files", "-z"], capture_output=True, timeout=300)
    if out.returncode != 0:
        raise RuntimeError("git ls-files failed")
    for path in out.stdout.decode("utf-8", "replace").split("\0"):
        if path:
            p = os.path.join(root, path)
            if os.path.isfile(p):
                yield path, os.path.getsize(p)


def broken_links(root, rev=None):
    """Lines in published text files that link into a left-out path."""
    # git grep with a wide plain filter (git's regex has no (?:) or \s), then the
    # exact pattern in Python on the lines it returns
    folders, data, files = _excluded_names()
    cmd = ["git", "-C", root, "grep", "-n", "-I", "-F"]
    for word in [f + "/" for f in folders] + data + files:
        cmd += ["-e", word]
    if rev:
        cmd.append(rev)
    cmd.append("--")
    cmd += ["*.html", "*.js", "*.mjs", "*.css", "*.json", "*.xml", "*.txt", "*.webmanifest", "*.py", "*.toml", "*.yml"]
    out = subprocess.run(cmd, capture_output=True, timeout=600)
    if out.returncode not in (0, 1):
        raise RuntimeError("git grep failed: " + out.stderr.decode("utf-8", "replace").strip())
    pat = re.compile(link_pattern())
    absolute = re.compile(absolute_pattern())
    hits = []
    for line in out.stdout.decode("utf-8", "replace").splitlines():
        path = line.split(":", 2)[1 if rev else 0]
        if (publishes(path) and pat.search(line)) or absolute.search(line):
            hits.append(line[:240])
    return hits


def plan(root=ROOT, rev=None):
    kept = left = 0
    left_by = {}
    keep = []
    for path, n in tracked(root, rev):
        if publishes(path):
            kept += n
            keep.append(path)
        else:
            left += n
            top = path.split("/", 1)[0] if "/" in path else path
            if top == "data":
                top = "/".join(path.split("/")[:2])
            left_by[top] = left_by.get(top, 0) + n
    return {"kept": kept, "left": left, "left_by": left_by, "keep": keep, "broken": broken_links(root, rev)}


def stage(root, dest, keep):
    """Copy the publish set into dest (hard links where the file system allows)."""
    for path in keep:
        src = os.path.join(root, path)
        dst = os.path.join(dest, path)
        os.makedirs(os.path.dirname(dst) or dest, exist_ok=True)
        try:
            os.link(src, dst)
        except OSError:
            shutil.copy2(src, dst)


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    ok(publishes("index.html") and publishes("rain/iowa/story-county.html") and publishes("data/prf/x.json"), "site files publish")
    ok(publishes(".well-known/security.txt") and publishes(".nojekyll") and publishes("CNAME"), "Pages files publish")
    ok(not publishes("scripts/a.py") and not publishes("test/fixtures/x.html") and not publishes("CLAUDE.md"), "tooling left out")
    ok(not publishes(".github/workflows/a.yml") and not publishes(".claude/settings.json"), "dot tooling left out")
    ok(not publishes("data/prf-stories/a.json") and publishes("data/prf-storiesx.json"), "data folders match by prefix")
    pat = re.compile(link_pattern())
    for bad in ('<script src="/scripts/x.js">', "fetch('/data/prf-stories/a.json')", '<a href="https://agsist.com/test/x.html">',
                "fetch(`/workers/a.js`)", '<link href="CLAUDE.md">'):
        ok(pat.search(bad), f"link into a left-out path caught: {bad}")
    for good in ('<script src="/components/x.js">', "<!-- written by scripts/build.py -->", "fetch('/data/prf/a.json')",
                 '<a href="/rain/scripts-of-rain.html">', "(scripts/inject_static_nav.py)"):
        ok(not pat.search(good), f"not a link into a left-out path: {good}")
    with tempfile.TemporaryDirectory() as d:
        def w(rel, text):
            os.makedirs(os.path.dirname(os.path.join(d, rel)) or d, exist_ok=True)
            with open(os.path.join(d, rel), "w") as f:
                f.write(text)
        w("index.html", '<script src="/components/a.js"></script>')
        w("components/a.js", "fetch('/data/a.json')")
        w("data/a.json", "{}")
        w("scripts/b.py", "x" * 1000)
        w(".well-known/security.txt", "Contact: x")
        w(".github/workflows/w.yml", "on: push")
        g = ["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t"]
        if subprocess.run(["git", "init", "-q", d], capture_output=True).returncode != 0:
            fails.append("git init failed")
        else:
            subprocess.run(g + ["add", "-A"], capture_output=True)
            subprocess.run(g + ["commit", "-q", "-m", "t"], capture_output=True)
            r = plan(d)
            ok(r["left"] == 1000 + len("on: push") and not r["broken"], f"dry run: {r['left']} left, broken {r['broken']}")
            ok(plan(d, rev="HEAD")["kept"] == r["kept"], "tree and checkout agree")
            out = os.path.join(d, "_site")
            stage(d, out, r["keep"])
            ok(os.path.isfile(os.path.join(out, ".well-known", "security.txt")) and os.path.isfile(os.path.join(out, "data", "a.json"))
               and not os.path.exists(os.path.join(out, "scripts")), "stage copies the site and leaves tooling out")
            w("rain.html", '<script src="/scripts/b.py"></script>')
            subprocess.run(g + ["add", "-A"], capture_output=True)
            subprocess.run(g + ["commit", "-q", "-m", "t2"], capture_output=True)
            ok(any("rain.html" in h for h in plan(d)["broken"]), "a page that loads a left-out file fails the dry run")
            ok(any("rain.html" in h for h in plan(d, rev="HEAD")["broken"]), "same on a tree")
            w("rain.html", "ok")
            w("workers/send.js", "fetch('https://agsist" + ".com/data/prf-stories/a.json')")  # split so this file passes its own scan
            subprocess.run(g + ["add", "-A"], capture_output=True)
            subprocess.run(g + ["commit", "-q", "-m", "t3"], capture_output=True)
            ok(any("workers/send.js" in h for h in plan(d)["broken"]), "a worker that fetches a left-out URL from the live site fails the dry run")
    for f in fails:
        print("FAIL", f)
    print("pages publish selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    rev = argv[argv.index("--tree") + 1] if "--tree" in argv and argv.index("--tree") + 1 < len(argv) else None
    dest = argv[argv.index("--stage") + 1] if "--stage" in argv and argv.index("--stage") + 1 < len(argv) else None
    if dest and rev:
        print("--stage copies the working tree; it does not take --tree")
        return 2
    try:
        r = plan(rev=rev)
    except RuntimeError as e:
        print("FAIL:", e)
        return 2
    mb = lambda b: round(b / 1048576, 1)
    print(f"publish set: {mb(r['kept'])} MB in {len(r['keep'])} files; left out: {mb(r['left'])} MB"
          f" ({'tree ' + rev if rev else 'working tree'})")
    for k, v in sorted(r["left_by"].items(), key=lambda kv: -kv[1])[:15]:
        print(f"  left out {k:34s}{mb(v):7.2f} MB")
    for h in r["broken"][:20]:
        print("BROKEN LINK:", h)
    if r["broken"]:
        print(f"{len(r['broken'])} reader-facing line(s) link to a left-out path; fix them before a filtered deploy")
        return 1
    if dest:
        stage(ROOT, dest, r["keep"])
        print(f"staged into {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
