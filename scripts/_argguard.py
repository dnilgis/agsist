"""Shared guard so a script never does work when asked for --help.

A script calls ``_argguard.guard(__file__)`` right after its docstring. When the
script is the one being run (not imported by a test or another script):
  -h / --help   print the script's usage (its docstring, else its top comment)
                and exit 0 before anything else runs.
  unknown flag  a dash argument that does not appear as a quoted string anywhere
                in the script's own source exits 2 with one short line.
A script that builds flag names at run time ("--" + name) is guarded for --help only.
Real arguments are untouched: any flag the script names in quotes passes, and
positional arguments are never checked.
"""
import ast
import os
import re
import sys

_FLAG = re.compile(r'''["'](-{1,2}[A-Za-z][\w-]*)''')
_DYN = re.compile(r'''["']--?["']\s*\+|f["']--?\{''')
_ARG = re.compile(r'^-{1,2}[A-Za-z][\w-]*(=.*)?$')


def usage_text(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        src = fh.read()
    doc = None
    try:
        doc = ast.get_docstring(ast.parse(src))
    except SyntaxError:
        pass
    if not doc:
        lines = []
        for line in src.splitlines()[1 if src.startswith("#!") else 0:]:
            if line.startswith("#"):
                lines.append(line.lstrip("#").strip())
            elif lines or line.strip():
                break
        doc = "\n".join(lines)
    return src, (doc or "").strip()


def guard(path, also=(), argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if argv is None and os.path.realpath(sys.argv[0]) != os.path.realpath(path):
        return  # imported, not run
    flags = [a for a in args if _ARG.match(a)]
    if not flags:
        return
    src, doc = usage_text(path)
    name = os.path.basename(path)
    if any(a in ("-h", "--help") for a in flags):
        print("usage: %s [-h]" % name)
        if doc:
            print()
            print("\n".join(doc.splitlines()[:40]))
        sys.exit(0)
    if _DYN.search(src):
        return  # flag names are built at run time; only --help is guarded
    known = set(_FLAG.findall(src))
    for other in also:  # sibling modules this script forwards its arguments to
        with open(os.path.join(os.path.dirname(os.path.abspath(path)), other), encoding="utf-8", errors="replace") as fh:
            known |= set(_FLAG.findall(fh.read()))
    for a in flags:
        if a.split("=", 1)[0] not in known:
            sys.stderr.write("%s: unknown option %s (try --help)\n" % (name, a.split("=", 1)[0]))
            sys.exit(2)
