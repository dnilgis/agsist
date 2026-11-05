#!/usr/bin/env python3
"""Neutral comments in .github/workflows/*.yml (Curtain P2a).

strip_comments(text, name) returns the workflow with its comments reduced to one neutral
header line plus the few operator notes in KEEP. compare(old, new) is True when the two
texts parse to the same workflow and every run block is the same apart from comment lines.
Used by test/workflow-comments.test.mjs; also: python3 scripts/dev/workflow_comments.py --apply
"""
import ast
import glob
import os
import re
import sys
import textwrap

import yaml

KEEP = re.compile(
    r"never force|do not force|force[- ]push|do not rename|secrets? needed"
    r"|\bSig\b.*approved|approved.*\bSig\b"
    r"|^\s*#\s*(-\s*cron:|schedule:|on:)"
    r"|cron above, by either trigger", re.I)
VERSION = re.compile(r"\s+#\s*v?\d")
BLOCK_OPEN = re.compile(r"(?::|^\s*-)\s+[|>][+-]?\d*\s*$")
HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")


def _is_comment(line):
    s = line.strip()
    return s.startswith("#") and not s.startswith("#!")


def _quote_safe_flags(lines):
    """True per line when it starts outside any quote and the previous line did not
    end with a backslash continuation."""
    flags = []
    q = None
    cont = False
    for ln in lines:
        flags.append(q is None and not cont)
        i = 0
        cont = False
        while i < len(ln):
            c = ln[i]
            if q is None:
                if c == "\\":
                    i += 2
                    continue
                if c == "#" and (i == 0 or ln[i - 1] in " \t"):
                    break
                if c in "'\"":
                    q = c
            elif q == "'":
                if c == "'":
                    q = None
            else:
                if c == "\\":
                    i += 2
                    continue
                if c == '"':
                    q = None
            i += 1
        if q is None and ln.rstrip().endswith("\\"):
            cont = True
    return flags


def _py_clean(body):
    kept = [ln for ln in body if not (_is_comment(ln) and not KEEP.search(ln))]
    try:
        if ast.dump(ast.parse(textwrap.dedent("\n".join(body)))) == ast.dump(ast.parse(textwrap.dedent("\n".join(kept)))):
            return kept
    except SyntaxError:
        pass
    return body


def _strip_block(body):
    """Drop whole-line shell comments from one block scalar body (list of lines).
    Python heredoc bodies lose comment lines only when the code is the same (ast)."""
    out = []
    shell = []

    def flush():
        flags = _quote_safe_flags(shell)
        out.extend(ln for ln, ok in zip(shell, flags) if not (ok and _is_comment(ln) and not KEEP.search(ln)))
        shell.clear()

    i = 0
    while i < len(body):
        ln = body[i]
        shell.append(ln)
        i += 1
        m = HEREDOC.search(ln)
        if m and not _is_comment(ln):
            tag = m.group(1)
            j = i
            while j < len(body) and body[j].strip() != tag:
                j += 1
            if j >= len(body):
                continue
            flush()
            hb = body[i:j]
            out.extend(_py_clean(hb) if re.search(r"python", ln) else hb)
            i = j
    flush()
    return out


def strip_comments(text, name=None):
    lines = text.split("\n")
    out = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        if not _is_comment(ln) and BLOCK_OPEN.search(ln):
            ind = len(ln) - len(ln.lstrip())
            out.append(ln)
            i += 1
            body = []
            while i < n and (lines[i].strip() == "" or len(lines[i]) - len(lines[i].lstrip()) > ind):
                body.append(lines[i])
                i += 1
            # trailing blank lines belong to the next section, not to the block
            tail = []
            while body and body[-1].strip() == "":
                tail.append(body.pop())
            body = _strip_block(body)
            while body and body[-1].strip() == "":
                tail.append(body.pop())
            out.extend(body)
            out.extend(tail)
            continue
        if _is_comment(ln) and not KEEP.search(ln):
            i += 1
            continue
        if ln.strip() == "" and out and out[-1].strip() == "":
            i += 1
            continue
        out.append(ln)
        i += 1
    res = _strip_trailing("\n".join(out))
    if name:
        res = _header(res, name)
    return res


def _strip_trailing(text):
    lines = text.split("\n")
    base = yaml.safe_load(text)
    blk_ind = None
    for k in range(len(lines)):
        ln = lines[k]
        ind = len(ln) - len(ln.lstrip())
        if blk_ind is not None:
            if ln.strip() == "" or ind > blk_ind:
                continue
            blk_ind = None
        if not _is_comment(ln) and BLOCK_OPEN.search(ln):
            blk_ind = ind
            continue
        mm = re.search(r"\s+#.*$", ln)
        if not mm or _is_comment(ln) or KEEP.search(ln) or VERSION.match(mm.group(0)):
            continue
        cand = ln[: mm.start()].rstrip()
        trial = lines[:k] + [cand] + lines[k + 1:]
        try:
            if yaml.safe_load("\n".join(trial)) == base:
                lines[k] = cand
        except yaml.YAMLError:
            pass
    return "\n".join(lines)


def _header(text, name):
    wf = yaml.safe_load(text) or {}
    title = str(wf.get("name") or name).strip().rstrip(".").replace(" \u2014 ", ": ")
    first = text.split("\n", 1)
    if first[0].startswith("name:"):
        rest = (first[1] if len(first) > 1 else "").lstrip("\n")
        return first[0] + "\n# " + title + ".\n\n" + rest
    return "# " + title + ".\n\n" + text.lstrip("\n")


def _norm_run(s):
    return "\n".join(re.sub(r"(\S)\s+# (?!v?\d).*$", r"\1", ln) for ln in s.split("\n") if not _is_comment(ln)).rstrip("\n")


def _walk(o):
    if isinstance(o, dict):
        return {k: (_norm_run(v) if k == "run" and isinstance(v, str) else _walk(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [_walk(v) for v in o]
    return o


def compare(old, new):
    return _walk(yaml.safe_load(old)) == _walk(yaml.safe_load(new))


def comment_lines(text):
    return [ln for ln in text.split("\n") if _is_comment(ln)]


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".github", "workflows")
    files = sorted(glob.glob(os.path.join(root, "*.yml")))
    if "--apply" not in sys.argv:
        print("pass --apply")
        return 1
    bad = removed = 0
    for f in files:
        old = open(f).read()
        new = strip_comments(old, os.path.basename(f)[:-4])
        if not compare(old, new):
            print("MISMATCH", f)
            bad += 1
            continue
        removed += len(comment_lines(old)) - len(comment_lines(new))
        open(f, "w").write(new)
    print("files", len(files), "mismatch", bad, "comment lines removed", removed)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
