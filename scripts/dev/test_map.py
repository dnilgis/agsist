#!/usr/bin/env python3
"""Which node tests can a change break? A static map from each test file to every file it reads.

The map comes from a scan of the tracked files, not from running anything:
  - a test, script, component or page "reads" every repo path written in it: string literals
    ('data/x.json', "/milk-prices", `rain/${st}/`), joined path parts (join(ROOT, "data", "x.json"),
    ROOT / "data" / "x.json"), relative imports, python imports of a sibling module, and in a
    page the src= and <link href=> of its scripts, styles and data (not its <a href> links);
  - a literal that names a folder ("rain/", join(ROOT, "rain", st)) reads everything in it;
  - a directory walk whose folder is not written out (readdirSync(ROOT), os.walk(REPO)) reads
    everything (the empty prefix);
  - code reads what the code it reads reads (scripts, components, pages, shell), to the end;
    data files (json, csv, yml, txt, ...) end the chain.
It errs toward more: a path written in a comment counts too.

  python3 scripts/dev/test_map.py                  write scripts/dev/test-map.json
  python3 scripts/dev/test_map.py --check          fail if the file is not what the scan gives
  python3 scripts/dev/test_map.py --select F ...   print the tests to run for changed files F
  python3 scripts/dev/test_map.py --select-base REF  the same for git diff REF...HEAD
  python3 scripts/dev/test_map.py --split N/M F ...  shard N of M of the files F, balanced by each file's
      measured time (scripts/dev/test-durations.json; a rough cost for a file not measured yet)
  python3 scripts/dev/test_map.py --durations T ...  write scripts/dev/test-durations.json from the
      "<ms>\t<file>" lines scripts/dev/file-times.mjs writes beside the TAP (several runs: the slowest)
      --github-output   also write mode=all|some and files=<space separated> to $GITHUB_OUTPUT
      --why             print the reason beside each test

Selection (pr-checks.yml, the "select tests" job):
  - a SHARED file (loader, header, styles, sw.js, the check scripts, this file, package files,
    the workflows) changed: every test;
  - a changed path the map cannot place (in neither this tree nor the base tree): every test;
  - otherwise the CORE tests, every changed test file, every test whose reads (in this tree's
    scan, or in the base's committed map for a deleted or renamed file) include a changed path,
    and any test file in the checkout that git does not track (an engine copy), so nothing that
    runs today is dropped.
The full suite runs on every push to main and nightly (main-checks.yml).
"""
import json
import os
import re
import subprocess
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try: import _argguard; _argguard.guard(__file__)  # scripts/_argguard.py: --help and bad flags exit before any work
except ImportError: pass
sys.path.pop(0)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = "scripts/dev/test-map.json"

# a change to one of these can move any test: run them all
SHARED = [
    "components/loader.js", "components/header.html", "components/footer.html",
    "components/header-fallback.html", "components/footer-fallback.html",
    "components/styles.css", "components/util.js", "sw.js",
    "scripts/dev/checks.sh", "scripts/dev/check-skips.sh", "scripts/dev/test_map.py",
    "scripts/dev/main_build.py", "test/skips-allowed.txt",
    "package.json", "package-lock.json", ".nvmrc",
    ".github/workflows/pr-checks.yml", ".github/workflows/main-checks.yml",
    ".github/actions/", ".github/engine-paths",
]
# always run in a pull request: the homepage, the menu, the engine and email rules, the
# workflow itself, and a smoke render of the top pages (budget and feeds are in "other checks")
CORE = [
    "test/engine.test.mjs", "test/ses-ready.test.mjs", "test/email-links.test.mjs",
    "test/pr-checks.test.mjs", "test/main-build.test.mjs", "test/home-front.test.mjs",
    "test/nav-full-oct18.test.mjs", "test/nav-fixes-oct18.test.mjs", "test/smoke-top-pages.test.mjs",
]
ROOT_NAMES = {"ROOT", "root", "REPO", "repo", "ROOT_DIR", "REPO_ROOT", "ROOTDIR", "__dirname", "HERE", "TOP", "SITE", "BASE_DIR", "cwd"}
CODE_EXT = (".py", ".mjs", ".js", ".cjs", ".sh", ".html")
MAX_BYTES = 3_000_000          # a file bigger than this is data, whatever its name
BASENAME_FANOUT = 25           # a bare file name matching more files than this is too vague to place

STR_RE = re.compile(r'"((?:[^"\\\n]|\\.){1,300})"|\'((?:[^\'\\\n]|\\.){1,300})\'|`((?:[^`\\]|\\.){1,600})`', re.S)
JOIN_RE = re.compile(r'\bjoin\(([^()]{0,400})\)')
SLASH_RE = re.compile(r'(?:"[^"\n]{1,120}"|\'[^\'\n]{1,120}\')(?:\s*/\s*(?:"[^"\n]{1,120}"|\'[^\'\n]{1,120}\'))+')
LIT_RE = re.compile(r'"([^"\n]{1,120})"|\'([^\'\n]{1,120})\'')
PYIMP_RE = re.compile(r'^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*))', re.M)
WALK_RE = re.compile(r'\b(?:readdirSync|readdir|opendirSync|globSync|os\.walk|os\.listdir|os\.scandir|\.rglob|\.glob|glob\.glob|iglob|\.iterdir)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)')
HTML_ATTR_RE = re.compile(r'<(?:script|img|source|iframe|link)\b[^>]*?\b(?:src|href)\s*=\s*["\']([^"\']+)["\']', re.I)
SCRIPT_RE = re.compile(r'<script\b[^>]*>(.*?)</script>', re.S | re.I)
SH_TOKEN_RE = re.compile(r'(?<![\w.$-])((?:\.{1,2}/)?[\w.-]+(?:/[\w.-]+)+/?|[\w-]+\.(?:py|mjs|js|sh|json|html|yml))')


def merge_base(root, ref, tries=6):
    """git merge-base REF HEAD; in a shallow checkout (the CI jobs) fetch deeper history until it is there"""
    for i in range(tries + 1):
        mb = subprocess.run(["git", "-C", root, "merge-base", ref, "HEAD"], capture_output=True, text=True)
        if mb.returncode == 0:
            return mb.stdout.strip()
        sh = subprocess.run(["git", "-C", root, "rev-parse", "--is-shallow-repository"], capture_output=True, text=True)
        if sh.stdout.strip() != "true" or i == tries:
            return None
        subprocess.run(["git", "-C", root, "fetch", "-q", "--no-tags", "--deepen=%d" % (100 * 2 ** i), "origin",
                        "HEAD", "+refs/heads/%s:refs/remotes/%s" % (ref.split("/", 1)[1], ref) if ref.startswith("origin/") else ref],
                       capture_output=True, text=True)
    return None


def git_files(ref=None):
    cmd = ["git", "-C", ROOT, "ls-files", "-z"] if ref is None else ["git", "-C", ROOT, "ls-tree", "-r", "-z", "--name-only", ref]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout.decode("utf-8", "replace")
    return [f for f in out.split("\0") if f]


class Tree:
    def __init__(self, files):
        self.files = set(files)
        self.dirs = set()
        self.by_base = {}
        for f in files:
            parts = f.split("/")
            for i in range(1, len(parts)):
                self.dirs.add("/".join(parts[:i]))
            self.by_base.setdefault(parts[-1], []).append(f)

    def resolve(self, lit, src, bare_dirs=False):
        """repo paths a literal written in src can mean: ('f', path) or ('d', 'prefix/')"""
        s = lit.strip()
        # the query and fragment do not name a file: "/components/loader.js?v=19" is components/loader.js
        # (before Oct 29 the "=" of "?v=19" threw out every versioned script and style a page loads)
        if not s or len(s) > 300 or any(c in s.split("?", 1)[0].split("#", 1)[0] for c in " \t\n<>{}|*\\,;=()[]") or s.startswith(("#", "data:", "mailto:", "tel:", "//")):
            return []
        m = re.match(r'https?://(?:www\.)?agsist\.com(/.*)?$', s)
        if m:
            s = m.group(1) or "/"
        elif "://" in s:
            return []
        s = s.split("?")[0].split("#")[0]
        if not s:
            return []
        here = os.path.dirname(src)
        cands = []
        if s.startswith("./") or s.startswith("../"):
            cands.append(os.path.normpath(os.path.join(here, s)))
        elif s.startswith("/"):
            cands.append(os.path.normpath(s.lstrip("/")) if s != "/" else "")
        else:
            cands.append(os.path.normpath(s))
            if here:
                cands.append(os.path.normpath(os.path.join(here, s)))
        out = []
        for c in cands:
            if c.startswith(".."):
                continue
            if c in ("", "."):
                if s == "/":
                    out.append(("f", "index.html"))
                continue
            for f in (c, c + ".html", c.rstrip("/") + "/index.html"):
                if f in self.files:
                    out.append(("f", f))
                    break
            else:
                if c in self.dirs and ("/" in s or bare_dirs):
                    out.append(("d", c + "/"))
        if not out and "/" not in s and "." in s and s in self.by_base and len(self.by_base[s]) <= BASENAME_FANOUT:
            out = [("f", f) for f in self.by_base[s]]
        return out


def literals(text):
    for m in STR_RE.finditer(text):
        if m.group(3) is not None:          # template: each static chunk on its own
            chunks = re.split(r'\$\{[^}]*\}', m.group(3))
            for i, c in enumerate(chunks):
                if not c:
                    continue
                if i < len(chunks) - 1 and "/" in c:
                    yield c[: c.rfind("/") + 1] if not c.endswith("/") else c, True
                    # a static chunk before an interpolation reads that folder
                yield c, False
        else:
            v = m.group(1) if m.group(1) is not None else m.group(2)
            yield v, False


def joined(text):
    """join(ROOT, "data", "x.json") and ROOT / "data" / "x.json": the literal parts in a row"""
    for m in JOIN_RE.finditer(text):
        run = []
        for a in m.group(1).split(","):
            a = a.strip()
            lm = re.fullmatch(r'"([^"\n]{1,120})"|\'([^\'\n]{1,120})\'', a)
            if lm:
                run.append(lm.group(1) or lm.group(2))
            else:
                if run:
                    yield "/".join(run)
                run = []
        if run:
            yield "/".join(run)
    for m in SLASH_RE.finditer(text):
        parts = [a or b for a, b in LIT_RE.findall(m.group(0))]
        yield "/".join(p.strip("/") for p in parts)


def scan(tree, path, text):
    """(files, dirs) this file reads"""
    files, dirs = set(), set()

    def add(lit, src=path, bare=False):
        for kind, p in tree.resolve(lit, src, bare_dirs=bare):
            (files if kind == "f" else dirs).add(p)

    ext = os.path.splitext(path)[1]
    if ext == ".html":
        for v in HTML_ATTR_RE.findall(text):
            add(v)
        for body in SCRIPT_RE.findall(text):
            for v, is_prefix in literals(body):
                for kind, p in tree.resolve(v, path):
                    if kind == "d" or not p.endswith(".html") or p.startswith("components/"):
                        (files if kind == "f" else dirs).add(p)
        return files, dirs
    for v, is_prefix in literals(text):
        add(v, bare=False)
    for v in joined(text):
        add(v, bare=True)
    if ext == ".sh":
        for v in SH_TOKEN_RE.findall(text):
            add(v)
    if ext == ".py":
        here = os.path.dirname(path)
        for a, b in PYIMP_RE.findall(text):
            for mod in ([a] if a else [x.strip() for x in b.split(",")]):
                rel = mod.replace(".", "/") + ".py"
                for c in (os.path.join(here, rel), os.path.join("scripts", rel)):
                    if c in tree.files:
                        files.add(c)
    # directory walks: the folder written in the call (up to the first wildcard); the repo root
    # read flat is "./" (the files at the top), read deep (os.walk, **, a walker that asks each
    # entry whether it is a folder) is "" (everything); a walk of a named constant reads the
    # folder written out where the constant is set, which the literal scan above already has
    walker_file = bool(re.search(r'isDirectory\(\)|withFileTypes|is_dir\(\)', text))
    fn_re = re.compile(r'(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|def\s+(\w+)\s*\()')
    for m in WALK_RE.finditer(text):
        call, arg = m.group(0), m.group(1)
        deep = bool(re.search(r'\*\*|recursive|os\.walk|rglob', call))
        pieces = list(joined(arg)) or [a or b for a, b in LIT_RE.findall(arg)] + [c for c in re.findall(r'`([^`$]*)', arg) if c]
        placed = False
        for v in pieces:
            segs = []
            for seg in v.split("/"):
                if re.search(r'[*?\[]', seg):
                    break
                segs.append(seg)
            base = "/".join(segs).strip("/")
            if not base:
                if v.strip("/") and re.search(r'[*?\[]', v):      # a pattern at the top: ROOT/*.html
                    dirs.add("" if deep else "./")
                    placed = True
                continue
            for kind, q in tree.resolve(base, path, bare_dirs=True):
                if kind == "d":
                    dirs.add(q)
                    placed = True
        if not placed:
            names = set(re.findall(r'[A-Za-z_$][\w$]*', arg))
            if not arg.strip() or re.fullmatch(r'\s*(?:(?:os\.path\.)?join\(\s*)?(?:%s)\s*\)?\s*(?:,.*)?' % "|".join(ROOT_NAMES), arg, re.S):
                dirs.add("" if deep else "./")
            elif walker_file and call.startswith(("readdir", "opendir", "os.walk")) and not pieces:
                # a recursive walker: what it is first handed decides; handed the root (or nothing) it
                # reads everything, handed a folder written out the literal scan has that folder
                fns = [g for mm in fn_re.finditer(text, 0, m.start()) for g in mm.groups() if g]
                fn = fns[-1] if fns else None
                if fn and re.search(r'\b%s\(\s*(?:\)|""|\'\'|(?:ROOT|root|REPO|repo|ROOT_DIR|__dirname)\s*[,)])' % re.escape(fn), text):
                    dirs.add("")
    return files, dirs


def build(tree_files=None):
    tracked = tree_files or git_files()
    tree = Tree(tracked)
    cache = {}

    def edges(f):
        if f not in cache:
            cache[f] = (set(), set())
            p = os.path.join(ROOT, f)
            if f.endswith(CODE_EXT) and os.path.isfile(p) and os.path.getsize(p) <= MAX_BYTES:
                try:
                    text = open(p, encoding="utf-8", errors="replace").read()
                except OSError:
                    text = ""
                cache[f] = scan(tree, f, text)
        return cache[f]

    code_in_dir = {}

    def dir_code(d):
        if d not in code_in_dir:
            code_in_dir[d] = sorted(f for f in tree.files if f.startswith(d) and f.endswith(CODE_EXT))
        return code_in_dir[d]

    dir_reads = {}

    def reads_of_dir(d):
        """the files and folders read by the code inside folder d (one level of edges, not the closure)"""
        if d not in dir_reads:
            fs, ds = set(), set()
            if d == "":
                dir_reads[d] = (fs, ds)
                return dir_reads[d]
            # generated sets repeat one template: scan a sample of each sub-folder's pages, all of its code
            pages = [f for f in dir_code(d) if f.endswith(".html")]
            other = [f for f in dir_code(d) if not f.endswith(".html")]
            seen_shape = {}
            for f in pages:
                key = os.path.dirname(f)
                if seen_shape.get(key, 0) >= 3:
                    continue
                seen_shape[key] = seen_shape.get(key, 0) + 1
                a, b = edges(f)
                fs |= a
                ds |= b
            for f in other:
                a, b = edges(f)
                fs |= a
                ds |= b
            dir_reads[d] = (fs, ds)
        return dir_reads[d]

    tests = sorted(f for f in tracked if f.startswith("test/") and f.endswith(".test.mjs"))
    out = {}
    for t in tests:
        files, dirs, todo, todo_d = set(), set(), [t], []
        while todo or todo_d:
            if todo_d:
                d = todo_d.pop()
                a2, b2 = reads_of_dir(d)
                todo.extend(x for x in a2 if x not in files)
                for d2 in b2:
                    if d2 not in dirs:
                        dirs.add(d2)
                        todo_d.append(d2)
                continue
            f = todo.pop()
            if f in files:
                continue
            files.add(f)
            a, b = edges(f)
            todo.extend(x for x in a if x not in files)
            for d in b:
                if d not in dirs:
                    dirs.add(d)
                    todo_d.append(d)
        files.discard(t)
        if "" in dirs:
            dirs = {""}
        # files inside a folder the test already reads are covered by the folder
        ds = sorted(dirs)
        fl = sorted(f for f in files if not any(under(f, d) for d in ds))
        out[t] = {"dirs": ds, "files": fl}
    return {
        "note": "Generated by scripts/dev/test_map.py from a static scan of the tracked files; rebuilt on main "
                "(main-checks.yml). Each test: the folders ('' = everything) and files it can read.",
        "shared": SHARED,
        "core": CORE,
        "tests": out,
    }


def dump(m):
    lines = ['{', ' "note": %s,' % json.dumps(m["note"]), ' "shared": %s,' % json.dumps(m["shared"]),
             ' "core": %s,' % json.dumps(m["core"]), ' "tests": {']
    items = list(m["tests"].items())
    for i, (t, v) in enumerate(items):
        lines.append('  %s: %s%s' % (json.dumps(t), json.dumps(v, separators=(",", ":")), "," if i < len(items) - 1 else ""))
    lines += [' }', '}', '']
    return "\n".join(lines)


def is_shared(p):
    return any(p == s or (s.endswith("/") and p.startswith(s)) for s in SHARED)


def under(p, d):
    return ("/" not in p) if d == "./" else p.startswith(d)


def readers(m, p):
    return [t for t, v in m["tests"].items() if p in v["files"] or any(under(p, d) for d in v["dirs"])]


def select(changed, head_map, base_map=None, head_files=None, base_files=None, present_tests=None):
    """-> (mode, {test: reason}); mode 'all' means run every test file"""
    head_files = set(head_files if head_files is not None else git_files())
    base_files = set(base_files or [])
    why = {}

    def add(t, r):
        why.setdefault(t, [])
        if r not in why[t]:
            why[t].append(r)

    for p in changed:
        if is_shared(p):
            return "all", {"*": ["shared file " + p]}
        if p not in head_files and p not in base_files:
            return "all", {"*": ["the map cannot place " + p]}
        if p not in head_files and base_map is None:
            return "all", {"*": [p + " is gone and the base map is missing"]}
    for t in CORE:
        if t in head_files:
            add(t, "core")
    for p in changed:
        if p.startswith("test/") and p.endswith(".test.mjs") and p in head_files:
            add(p, "changed")
        for t in readers(head_map, p):
            add(t, "reads " + p)
        if base_map is not None:
            for t in readers(base_map, p):
                if t in head_files:
                    add(t, "read " + p + " before")
    for t in sorted(present_tests or []):
        if t not in head_files:
            add(t, "in the checkout, not tracked (engine copy)")
    return "some", why


def present_test_files():
    d = os.path.join(ROOT, "test")
    return ["test/" + f for f in os.listdir(d) if f.endswith(".test.mjs")] if os.path.isdir(d) else []


DURATIONS = "scripts/dev/test-durations.json"
# the PR checks' runners have 4 cores and node --test runs (cores - 1) = 3 files at a time; measured on
# Oct 29 a shard's wall time was its files' summed time over about 2.4 (browser tests share the cores)
SHARD_PARALLEL = 2.4
_measured = None


def measured():
    """{test file: seconds} from scripts/dev/test-durations.json (empty when it is missing or unreadable)"""
    global _measured
    if _measured is None:
        try:
            _measured = {k: float(v) for k, v in json.load(open(os.path.join(ROOT, DURATIONS), encoding="utf-8"))["seconds"].items()}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            _measured = {}
    return _measured


def weight(path):
    """seconds: the measured time of the file in the PR checks, else a rough guess (browser tests are slow,
    big files have more tests)"""
    m = measured()
    if path in m:
        return m[path]
    try:
        text = open(os.path.join(ROOT, path), encoding="utf-8", errors="replace").read()
    except OSError:
        return 1.0
    return 1.0 + len(text) / 10000.0 + (20.0 if "CHROMIUM_PATH" in text else 0.0)


def split(files, n, m, par=SHARD_PARALLEL):
    """shard n of m (1-based) of files, balanced by weight: longest first, each onto the shard that would
    finish soonest with it, where a shard's time is the longer of its longest file and its total over the
    files it runs at once"""
    tot, top = [0.0] * m, [0.0] * m
    out = [[] for _ in range(m)]
    for w, f in sorted(((weight(f), f) for f in sorted(set(files))), key=lambda x: (-x[0], x[1])):
        i = min(range(m), key=lambda k: (max(top[k], w, (tot[k] + w) / par), tot[k], k))
        tot[i] += w
        top[i] = max(top[i], w)
        out[i].append(f)
    return sorted(out[n - 1])


def write_durations(paths):
    secs = {}
    for p in paths:
        for line in open(p, encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 2 or not parts[0].isdigit():
                continue
            secs[parts[1]] = max(secs.get(parts[1], 0.0), round(int(parts[0]) / 1000.0, 1))
    doc = {"note": "Wall time in seconds of each node test file in the PR checks (scripts/dev/file-times.mjs, the "
                   "'test file times' step of pr-checks.yml); the slowest of the runs read. test_map.py --split "
                   "balances the shards by it. Refresh: python3 scripts/dev/test_map.py --durations <times files>.",
           "seconds": dict(sorted(secs.items()))}
    with open(os.path.join(ROOT, DURATIONS), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, indent=0, sort_keys=False) + "\n")
    print("wrote %s (%d files)" % (DURATIONS, len(secs)))
    return 0


def main(argv):
    if "--split" in argv:
        i = argv.index("--split")
        mm = re.fullmatch(r"([1-9]\d*)/([1-9]\d*)", argv[i + 1] if len(argv) > i + 1 else "")
        if not mm or int(mm.group(1)) > int(mm.group(2)):
            print("test_map.py: --split wants N/M with 1<=N<=M", file=sys.stderr)
            return 2
        for f in split(argv[i + 2:], int(mm.group(1)), int(mm.group(2))):
            print(f)
        return 0
    if "--durations" in argv:
        return write_durations(argv[argv.index("--durations") + 1:])
    if "--check" in argv:
        want = dump(build())
        have = open(os.path.join(ROOT, OUT), encoding="utf-8").read() if os.path.exists(os.path.join(ROOT, OUT)) else ""
        if want != have:
            print(OUT + " is stale (it is rebuilt on main; run python3 scripts/dev/test_map.py to see it)")
            return 1
        print(OUT + " matches the scan")
        return 0
    if "--select" in argv or "--select-base" in argv:
        base_map, base_files = None, []
        if "--select-base" in argv:
            ref = argv[argv.index("--select-base") + 1]
            base = merge_base(ROOT, ref)
            if not base:
                return emit("all", {"*": ["no merge base with " + ref]}, argv)
            changed = [f for f in subprocess.run(["git", "-C", ROOT, "diff", "--name-only", "--no-renames", base, "HEAD"],
                                                 capture_output=True, text=True, check=True).stdout.split("\n") if f]
            base_files = git_files(base)
            r = subprocess.run(["git", "-C", ROOT, "show", base + ":" + OUT], capture_output=True, text=True)
            if r.returncode == 0:
                try:
                    base_map = json.loads(r.stdout)
                except ValueError:
                    base_map = None
        else:
            i = argv.index("--select")
            changed = [a for a in argv[i + 1:] if not a.startswith("--")]
        # a shared file or a path the map cannot place decides "every test" before the scan (about 15 s)
        mode, why = select(changed, {"tests": {}}, base_map, base_files=base_files, present_tests=present_test_files())
        if mode == "all":
            return emit(mode, why, argv, len(changed))
        try:
            head_map = build()
        except Exception as e:  # the map cannot decide
            return emit("all", {"*": ["the scan failed: %s" % e]}, argv)
        mode, why = select(changed, head_map, base_map, base_files=base_files, present_tests=present_test_files())
        return emit(mode, why, argv, len(changed))
    with open(os.path.join(ROOT, OUT), "w", encoding="utf-8") as fh:
        fh.write(dump(build()))
    print("wrote " + OUT)
    return 0


def emit(mode, why, argv, n_changed=None):
    tests = sorted(t for t in why if t != "*")
    if mode == "all":
        print("select: every test (%s)" % "; ".join(why["*"]))
    else:
        print("select: %d test file(s) for %s changed file(s)" % (len(tests), n_changed))
        for t in tests:
            print("  " + t + ("   " + "; ".join(why[t][:3]) + (" (+%d more)" % (len(why[t]) - 3) if len(why[t]) > 3 else "") if "--why" in argv else ""))
    gh = os.environ.get("GITHUB_OUTPUT")
    if "--github-output" in argv and gh:
        with open(gh, "a", encoding="utf-8") as fh:
            fh.write("mode=%s\nfiles=%s\ncount=%d\n" % (mode, " ".join(tests) if mode == "some" else "", len(tests)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
