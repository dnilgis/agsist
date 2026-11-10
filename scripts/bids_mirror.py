"""Weekly copy of the bids repository's full history to a private backup repository.

  python3 scripts/bids_mirror.py              copy and verify (the bids-mirror workflow)
  python3 scripts/bids_mirror.py --selftest   local repositories only, no network

Every branch and tag of the source is copied. Each run sends only what the backup does not have yet.
A ref on the backup only moves forward: a branch the source deleted stays on the backup, and when the
source rewrote a branch the backup's old tip is first kept as the tag kept/<date>/<branch>, so a
damaged source can never erase the copy. A first copy (or a long gap) goes up in steps along each
branch, so no single push is too large; a step that fails is halved and tried again.

After the push it checks that every source branch and tag points at the same commit on the backup and
that every source commit is reachable there, then prints one status line (date, commits, size).

Environment:
  BIDS_BACKUP_REPO    owner/name of the backup (default dnilgis/bids-backup); it must be private
  PRIVATE_REPO_TOKEN  the key that reads and writes the backup (never printed)
  MIRROR_SRC          source URL or path (default https://github.com/dnilgis/bids.git)
  MIRROR_DST          backup URL or path (tests; skips the GitHub lookup)
  MIRROR_DIR          bare work repository (default a temporary folder)
  MIRROR_CHUNK        commits per step of a first copy (default 400)
  MIRROR_STATUS       file the status line is appended to
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_BACKUP = "dnilgis/bids-backup"
DEFAULT_SRC = "https://github.com/dnilgis/bids.git"
SOURCE_REPO = "dnilgis/bids"
SEED_REF = "refs/heads/_mirror_seed"
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
UNREACHABLE = ("the backup repository {repo} cannot be reached with PRIVATE_REPO_TOKEN. Either it does not "
               "exist yet (create it on GitHub as an empty private repository named {repo}) or the key's "
               "repository access does not include it (add {repo} to the key, Contents: read and write).")


class MirrorError(Exception):
    pass


class Mirror:
    def __init__(self, env, log=print):
        self.env = env
        self.log = log
        self.token = env.get("PRIVATE_REPO_TOKEN", "")
        self.pushes = 0

    def hide(self, text):
        text = re.sub(r"x-access-token:[^@\s]*@", "x-access-token:***@", text or "")
        return text.replace(self.token, "***") if self.token else text

    def git(self, *args, cwd=None, check=True):
        genv = dict(os.environ)
        genv.update({"GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_COUNT": "1",
                     "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader", "GIT_CONFIG_VALUE_0": ""})
        p = subprocess.run(["git", *args], cwd=cwd or self.work, env=genv, capture_output=True, text=True)
        if check and p.returncode != 0:
            last = " ".join(self.hide(p.stderr).strip().splitlines()[-3:])
            raise MirrorError("git %s failed: %s" % (args[0], last))
        return p

    # ------------------------------------------------------------------ where
    def backup(self):
        repo = self.env.get("BIDS_BACKUP_REPO") or DEFAULT_BACKUP
        if not REPO_RE.match(repo):
            raise MirrorError("BIDS_BACKUP_REPO must look like owner/name")
        if repo.lower() == SOURCE_REPO:
            raise MirrorError("BIDS_BACKUP_REPO names the source itself; the backup must be a separate repository")
        self.repo = repo
        if self.env.get("MIRROR_DST"):
            return self.env["MIRROR_DST"]
        if not self.token:
            raise MirrorError("PRIVATE_REPO_TOKEN is not set; " + UNREACHABLE.format(repo=repo))
        req = urllib.request.Request("https://api.github.com/repos/" + repo, headers={
            "Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
            "User-Agent": "bids-mirror"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                info = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                raise MirrorError(UNREACHABLE.format(repo=repo) + " (GitHub answered %d)" % e.code)
            raise MirrorError("GitHub lookup of %s failed: HTTP %d" % (repo, e.code))
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise MirrorError("GitHub lookup of %s failed: %s" % (repo, self.hide(str(e))))
        check_visibility(repo, info)
        return "https://x-access-token:%s@github.com/%s.git" % (self.token, repo)

    # ------------------------------------------------------------------ refs
    def remote_refs(self, url):
        p = self.git("ls-remote", "--refs", url, "refs/heads/*", "refs/tags/*", check=False)
        if p.returncode != 0:
            raise MirrorError(UNREACHABLE.format(repo=self.repo) + " (git: %s)" % self.hide(p.stderr).strip().splitlines()[-1:])
        refs = {}
        for line in p.stdout.splitlines():
            sha, ref = line.split("\t", 1)
            refs[ref] = sha
        return refs

    def local_refs(self, *patterns):
        out = self.git("for-each-ref", "--format=%(objectname) %(refname)", *patterns).stdout
        return {r: s for s, r in (l.split(" ", 1) for l in out.splitlines() if l)}

    def have(self, sha):
        return self.git("cat-file", "-e", sha + "^{commit}", check=False).returncode == 0

    def is_ancestor(self, a, b):
        return self.git("merge-base", "--is-ancestor", a, b, check=False).returncode == 0

    def push(self, dst, *specs, atomic=False):
        args = ["push", "--porcelain"] + (["--atomic"] if atomic else []) + [dst, *specs]
        p = self.git(*args, check=False)
        self.pushes += 1
        return p

    # ------------------------------------------------------------------ run
    def run(self, today=None):
        today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        dst = self.backup()
        src = self.env.get("MIRROR_SRC") or DEFAULT_SRC
        self.work = self.env.get("MIRROR_DIR") or tempfile.mkdtemp(prefix="bids-mirror-")
        if not os.path.isdir(os.path.join(self.work, "objects")):
            os.makedirs(self.work, exist_ok=True)
            self.git("init", "-q", "--bare", self.work, cwd=self.work)

        before = self.remote_refs(dst)
        self.log("backup %s: %d branches and tags before this run" % (self.repo, len(before)))
        for attempt in range(3):
            p = self.git("fetch", "-q", "--prune", "--no-tags", src,
                         "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*", check=False)
            if p.returncode == 0:
                break
        else:
            raise MirrorError("could not fetch the source: %s" % self.hide(p.stderr).strip().splitlines()[-1:])
        src_refs = self.local_refs("refs/heads", "refs/tags")
        if not any(r.startswith("refs/heads/") for r in src_refs):
            raise MirrorError("the source has no branches; nothing copied")

        # refs the source rewound or moved off the backup's history: keep the backup's old tip first
        stamp = today.replace("-", "")
        kept, specs = [], []
        for ref, sha in sorted(src_refs.items()):
            old = before.get(ref)
            if old == sha:
                continue
            if old and not (self.have(old) and self.is_ancestor(old, sha)):
                short = ref.split("/", 2)[2] if ref.startswith("refs/heads/") else "tags/" + ref.split("/", 2)[2]
                keep = "refs/tags/kept/%s/%s" % (stamp, short)
                self.git("fetch", "-q", "--no-tags", dst, "+%s:%s" % (ref, keep))
                kept.append(keep)
                specs.append("+%s:%s" % (sha, ref))
            else:
                specs.append("%s:%s" % (sha, ref))

        seeded = self.seed(dst, src_refs, before)
        if specs or kept:
            p = self.push(dst, *specs, *["%s:%s" % (k, k) for k in kept], atomic=True)
            if p.returncode != 0:
                raise MirrorError("the push to the backup was refused: %s" % " ".join(self.hide(p.stdout + p.stderr).strip().splitlines()[-3:]))
        if seeded:  # only now: while it stands, the backup tells git which commits it already holds
            self.push(dst, ":" + SEED_REF)

        # verify: same tips, every source commit reachable on the backup
        after = self.remote_refs(dst)
        wrong = sorted(r for r, s in src_refs.items() if after.get(r) != s)
        if wrong:
            raise MirrorError("after the push %d refs differ on the backup: %s" % (len(wrong), ", ".join(wrong[:5])))
        self.git("fetch", "-q", "--no-tags", dst, "+refs/heads/*:refs/verify/heads/*", "+refs/tags/*:refs/verify/tags/*")
        missing = int(self.git("rev-list", "--count", "--branches", "--tags", "--not", "--glob=refs/verify/*").stdout.strip())
        if missing:
            raise MirrorError("%d source commits are not reachable on the backup" % missing)
        commits = int(self.git("rev-list", "--count", "--branches", "--tags").stdout.strip())
        backup_commits = int(self.git("rev-list", "--count", "--glob=refs/verify/*").stdout.strip())
        for r in self.local_refs("refs/verify"):
            self.git("update-ref", "-d", r)
        size = self.size()
        line = ("%s ok commits=%d backup_commits=%d refs=%d backup_refs=%d updated=%d kept=%d size=%s"
                % (today, commits, backup_commits, len(src_refs), len(after), len(specs), len(kept), size))
        return line, kept

    def seed(self, dst, src_refs, before):
        """Push long runs of new commits in steps, so no single push is too large."""
        chunk = max(1, int(self.env.get("MIRROR_CHUNK") or 400))
        base = [s for s in set(before.values()) if self.have(s)]
        seeded = False
        for ref in sorted(r for r in src_refs if r.startswith("refs/heads/")):
            out = self.git("rev-list", "--first-parent", "--reverse", src_refs[ref], "--not", *base).stdout.split()
            if len(out) <= chunk:
                continue
            i, step = 0, chunk
            while i < len(out) - 1:
                target = out[min(i + step, len(out)) - 1]
                p = self.push(dst, "+%s:%s" % (target, SEED_REF))
                if p.returncode == 0:
                    seeded = True
                    self.log("first copy %s: %d of %d commits up" % (ref, min(i + step, len(out)), len(out)))
                    i += step
                elif step > 1:
                    step //= 2
                    self.log("first copy %s: a step was refused; trying %d commits per step" % (ref, step))
                else:
                    raise MirrorError("a one-commit push to the backup was refused: %s"
                                      % " ".join(self.hide(p.stdout + p.stderr).strip().splitlines()[-3:]))
            base.append(src_refs[ref])
        return seeded

    def size(self):
        kib = 0
        for l in self.git("count-objects", "-v").stdout.splitlines():
            k, _, v = l.partition(": ")
            if k in ("size", "size-pack"):
                kib += int(v)
        return "%.2fGB" % (kib / 1048576.0) if kib >= 1048576 else "%.1fMB" % (kib / 1024.0)


def check_visibility(repo, info):
    if not isinstance(info, dict) or "private" not in info:
        raise MirrorError("GitHub's answer for %s has no visibility; not copying" % repo)
    if info["private"] is not True:
        raise MirrorError("%s is public; the backup must be a private repository. Not copying." % repo)
    perms = info.get("permissions")
    if isinstance(perms, dict) and perms.get("push") is False:
        raise MirrorError(UNREACHABLE.format(repo=repo) + " (the key can read it but not write)")


def record(env, line):
    path = env.get("MIRROR_STATUS")
    if path:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    summary = env.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("Bids backup: " + line + "\n")


def main(env=None, log=print, today=None):
    env = dict(os.environ if env is None else env)
    today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    m = Mirror(env, log)
    try:
        line, _ = m.run(today)
    except MirrorError as e:
        msg = m.hide(str(e))
        log("::error::bids backup: " + msg)
        record(env, "%s FAILED %s" % (today, msg))
        return 1
    log(line)
    record(env, line)
    return 0


# ---------------------------------------------------------------------- selftest
def selftest():
    fails = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)

    t = tempfile.mkdtemp(prefix="bids-mirror-test-")
    try:
        def sh(*args, cwd):
            return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

        src = os.path.join(t, "src")
        os.makedirs(src)
        sh("init", "-q", "-b", "main", cwd=src)
        sh("config", "user.email", "t@example.invalid", cwd=src)
        sh("config", "user.name", "t", cwd=src)

        def commit(n, cwd=src):
            for i in range(n):
                with open(os.path.join(cwd, "f.txt"), "a") as fh:
                    fh.write("%s\n" % os.urandom(4).hex())
                sh("add", "f.txt", cwd=cwd)
                sh("commit", "-q", "-m", "c", cwd=cwd)

        commit(23)
        sh("tag", "-a", "v1", "-m", "v1", cwd=src)
        sh("branch", "side", cwd=src)
        commit(2)
        dst = os.path.join(t, "dst.git")
        sh("init", "-q", "--bare", dst, cwd=t)
        # the backup refuses any push that brings more than 3 new commits, like a size limit would
        hook = os.path.join(dst, "hooks", "pre-receive")
        with open(hook, "w") as fh:
            fh.write("#!/bin/sh\nwhile read old new ref; do\n"
                     "  case $new in 0000000000000000000000000000000000000000) continue;; esac\n"
                     "  n=$(git rev-list --count $new --not --branches --tags)\n"
                     "  [ \"$n\" -gt 3 ] && { echo too big >&2; exit 1; }\ndone\nexit 0\n")
        os.chmod(hook, 0o755)
        status = os.path.join(t, "status", "bids-mirror.log")
        env = {"MIRROR_SRC": src, "MIRROR_DST": dst, "MIRROR_DIR": os.path.join(t, "work.git"), "MIRROR_CHUNK": "8",
               "MIRROR_STATUS": status, "BIDS_BACKUP_REPO": "dnilgis/bids-backup", "PRIVATE_REPO_TOKEN": "sekrit-123"}
        logs = []
        rc = main(env, logs.append, "2026-11-15")
        heads = lambda d: sh("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/tags", cwd=d)
        check(rc == 0, "first copy: exit 0")
        check(heads(src) == heads(dst), "first copy: every branch and tag matches the source")
        check(any("trying 4 commits per step" in l for l in logs) and any("trying 2 commits per step" in l for l in logs),
              "first copy: a refused step is halved and tried again")
        check(SEED_REF.split("/")[-1] not in sh("branch", "-a", cwd=dst), "first copy: the temporary step branch is gone")
        st = open(status).read().splitlines()
        check(len(st) == 1 and st[0].startswith("2026-11-15 ok commits=25 backup_commits=25 refs=3 "), "first copy: status line " + st[0])
        check(re.search(r"size=\d", st[0]) is not None, "status line carries the size")

        commit(2)
        logs.clear()
        rc = main(env, logs.append, "2026-11-22")
        check(rc == 0 and heads(src) == heads(dst), "a later week: only the new commits, tips match")
        check(open(status).read().splitlines()[-1].startswith("2026-11-22 ok commits=27 "), "a later week: status appended")

        old = sh("rev-parse", "main", cwd=src)
        sh("reset", "-q", "--hard", "HEAD~3", cwd=src)
        commit(1)
        sh("branch", "-D", "side", cwd=src)
        rc = main(env, logs.append, "2026-11-29")
        check(rc == 0, "a rewritten source branch: exit 0")
        check(sh("rev-parse", "main", cwd=dst) == sh("rev-parse", "main", cwd=src), "rewritten: the backup follows the new tip")
        check(sh("rev-parse", "kept/20261129/main^{commit}", cwd=dst) == old, "rewritten: the old tip is kept as a tag on the backup")
        check("side" in sh("branch", "--list", "side", cwd=dst), "a branch the source deleted stays on the backup")

        bad = dict(env, MIRROR_DST=os.path.join(t, "nowhere.git"))
        logs.clear()
        rc = main(bad, logs.append, "2026-12-06")
        msg = " ".join(logs)
        check(rc == 1 and "does not exist yet" in msg and "repository access" in msg, "no backup repository: exit 1 with one clear message")
        check("sekrit-123" not in msg and "sekrit-123" not in open(status).read(), "the key is never printed or written")
        check(open(status).read().splitlines()[-1].startswith("2026-12-06 FAILED the backup repository"), "a failed run is recorded too")

        for e2, word in ((dict(env, BIDS_BACKUP_REPO="dnilgis/bids"), "source itself"),
                         (dict(env, BIDS_BACKUP_REPO="not a repo"), "owner/name"),
                         ({k: v for k, v in env.items() if k not in ("MIRROR_DST", "PRIVATE_REPO_TOKEN")}, "not set")):
            logs.clear()
            check(main(e2, logs.append, "2026-12-06") == 1 and word in " ".join(logs), "refused: " + word)

        for info, ok, what in (({"private": True, "permissions": {"push": True}}, True, "a private repo the key can write"),
                               ({"private": False}, False, "a public repo"),
                               ({"private": True, "permissions": {"push": False}}, False, "a repo the key cannot write"),
                               ({}, False, "no visibility in the answer")):
            try:
                check_visibility("dnilgis/bids-backup", info)
                got = True
            except MirrorError:
                got = False
            check(got is ok, "visibility check: " + what)
    finally:
        shutil.rmtree(t, ignore_errors=True)
    print("\n%d failed" % len(fails) if fails else "\nall bids_mirror checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        sys.exit(selftest())
    if sys.argv[1:]:
        print("usage: bids_mirror.py [--selftest]")
        sys.exit(2)
    sys.exit(main())
