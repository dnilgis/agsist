#!/usr/bin/env python3
"""trace_reads.py: run a Python builder and record every repository file it reads (Nov 4, 2026).

WHY. build rule 61: a builder run by hand must leave every file that summarises its output current. On Nov 4
a hand run of the Cash Bid Index left llms.txt on the partial edition and main went red. scripts/generated_sets.py
lists, per generated set, the summary files rebuilt after it (its dependents). This script is how the test
(test/generated-sets.test.mjs) learns what a summary builder really reads, so a new read cannot go undeclared.

HOW. The builder runs in this process (runpy) under an audit hook that records each file opened and each folder
listed inside the repository. Nothing in the repository is written: a write is sent to a temporary folder (and
read back from there), a rename, delete or new folder inside the repository goes to that folder too, and any
other write into the repository is refused. Bytecode is not written. Child processes (git) are not traced.

    python3 scripts/trace_reads.py OUT.json scripts/build_llms_txt.py --check

OUT.json: {"rc": exit code, "read": [repository paths], "listed": [folders], "written": [paths it tried to write]}
"""
import sys
if __name__ == "__main__":
    # --help and a bad flag of its own exit before any work (build rule 46); the arguments after the
    # builder's path are the builder's, so only the ones before it are checked here
    _own = []
    for _a in sys.argv[1:]:
        if _a.endswith(".py"):
            break
        _own.append(_a)
    try: import _argguard; _argguard.guard(__file__, argv=_own)
    except ImportError: pass
import builtins
import io
import json
import os
import runpy
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    out, script, args = argv[0], argv[1], argv[2:]
    tmp = tempfile.mkdtemp(prefix="trace-")
    seen = {"read": set(), "listed": set(), "written": set()}
    real_open, real_io_open = builtins.open, io.open
    real = {k: getattr(os, k) for k in ("replace", "rename", "remove", "unlink", "makedirs", "mkdir", "rmdir")}

    def rel(p):
        try:
            p = os.fsdecode(p)
        except TypeError:
            return None
        a = os.path.abspath(p)
        if a == ROOT or a.startswith(ROOT + os.sep):
            return os.path.relpath(a, ROOT)
        return None

    def shadow(r):
        return os.path.join(tmp, r)

    def is_write(mode):
        return any(c in (mode or "r") for c in "wax+")

    def opener(orig):
        def o(file, mode="r", *a, **k):
            r = rel(file) if not isinstance(file, int) else None
            if r is not None:
                if is_write(mode):
                    seen["written"].add(r)
                    s = shadow(r)
                    real["makedirs"](os.path.dirname(s), exist_ok=True)
                    if ("a" in mode or "+" in mode) and not os.path.exists(s) and os.path.isfile(file):
                        shutil.copyfile(file, s)
                    return orig(s, mode, *a, **k)
                seen["read"].add(r)
                if os.path.exists(shadow(r)):
                    return orig(shadow(r), mode, *a, **k)
            return orig(file, mode, *a, **k)
        return o

    def two(name):
        def f(src, dst, *a, **k):
            rs, rd = rel(src), rel(dst)
            if rd is not None:
                seen["written"].add(rd)
                real["makedirs"](os.path.dirname(shadow(rd)), exist_ok=True)
                return real[name](shadow(rs) if rs is not None and os.path.exists(shadow(rs)) else src, shadow(rd))
            return real[name](src, dst, *a, **k)
        return f

    def one(name):
        def f(p, *a, **k):
            r = rel(p)
            if r is not None:
                seen["written"].add(r)
                if name in ("makedirs", "mkdir"):
                    return real["makedirs"](shadow(r), exist_ok=True)
                if os.path.lexists(shadow(r)):
                    return real[name](shadow(r))
                return None
            return real[name](p, *a, **k)
        return f

    builtins.open = opener(real_open)
    io.open = opener(real_io_open)
    for n in ("replace", "rename"):
        setattr(os, n, two(n))
    for n in ("remove", "unlink", "makedirs", "mkdir", "rmdir"):
        setattr(os, n, one(n))

    def hook(ev, a):
        if ev == "open" and a and not isinstance(a[0], int):
            r = rel(a[0])
            if r is None:
                return
            mode, flags = a[1] or "", a[2] or 0
            if is_write(mode) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
                raise PermissionError("trace_reads.py: a write into the repository outside open(): " + r)
            seen["read"].add(r)
        elif ev in ("os.listdir", "os.scandir"):
            p = a[0] if a and a[0] is not None else "."
            if not isinstance(p, int):
                r = rel(p)
                if r is not None:
                    seen["listed"].add(r)

    sys.addaudithook(hook)
    rc = 0
    old_argv, old_path = sys.argv, list(sys.path)
    sys.argv = [os.path.abspath(script)] + args
    sys.path.insert(0, os.path.dirname(os.path.abspath(script)))
    cwd = os.getcwd()
    try:
        runpy.run_path(os.path.abspath(script), run_name="__main__")
    except SystemExit as e:
        rc = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        os.chdir(cwd)
        sys.argv, sys.path[:] = old_argv, old_path
        builtins.open, io.open = real_open, real_io_open
        for n, f in real.items():
            setattr(os, n, f)
        real_shutil_rmtree = shutil.rmtree
        real_shutil_rmtree(tmp, ignore_errors=True)
    with real_open(out, "w", encoding="utf-8") as fh:
        json.dump({"rc": rc, **{k: sorted(v) for k, v in seen.items()}}, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
