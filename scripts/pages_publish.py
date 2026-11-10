#!/usr/bin/env python3
"""What a publish-only-the-site Pages deploy would publish. A plan, not switched on.

Today Pages deploys the main branch as-is (.nojekyll), so scripts/, test/ and
the other folders in check_site_budget.NOT_READER_FACING are served and count
toward the 1 GB limit although no reader loads them. A Pages deploy from a
filtered artifact (actions/deploy-pages) would leave them out. This script is
that filter, and its dry run:

  python3 scripts/pages_publish.py                     # dry run on the working tree
  python3 scripts/pages_publish.py --tree origin/main  # dry run on a commit (sparse checkouts too)
  python3 scripts/pages_publish.py --stage _site       # copy the publish set into _site
  python3 scripts/pages_publish.py --stage _site --minify --terser DIR   # and minify the copies (the workflow)
  python3 scripts/pages_publish.py --selftest

The dry run prints the bytes kept and left out and fails (exit 1) when a
reader-facing file links to something the filter would leave out: a page that
loads /scripts/x.js would break the day the deploy switched. The workflow runs
the same check before it uploads, so a broken link stops the deploy instead of
reaching readers. The plan and the workflow are in the private repo
the private notes.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_site_budget as budget  # noqa: E402

ROOT = budget.ROOT
# Pages needs these although they start with a dot or sit at the root.
KEEP_ALWAYS = budget.KEEP_ALWAYS


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
    """True when the filtered artifact keeps rel (a path with /). One rule for the
    deploy and the size gate: check_site_budget counts exactly these bytes."""
    return budget.publishes(rel)


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


# The published copy is compacted: page scripts, the service worker and style sheets lose their comments and
# spacing in _site, the repository files stay as they are, names and ?v= URLs do not change, and no source map
# is written. A file that cannot be minified safely is published as it is.
MINIFY = re.compile(r"(?:components/[^/]+\.(?:js|css)|css/[^/]+\.css|sw\.js)")
TERSER_VERSION = "5.51.2"   # pinned; .github/workflows/pages.yml installs the same (test/pages-publish.test.mjs)
TERSER_TIMEOUT = 900
TERSER_JS = r"""
const fs = await import('node:fs'); const vm = await import('node:vm');
const { minify } = await import(process.env.TERSER_MAIN);
const files = JSON.parse(fs.readFileSync(0, 'utf8')); const out = {};
for (const p of files) {
  try {
    const src = fs.readFileSync(p, 'utf8');
    const r = await minify(src, { compress: false, mangle: true, sourceMap: false, format: { comments: p.endsWith('sw.js') ? false : 'some' } });
    if (typeof r.code !== 'string') throw new Error('no output');
    new vm.Script(r.code);
    fs.writeFileSync(p + '.min-tmp', r.code); fs.renameSync(p + '.min-tmp', p);
    out[p] = 'ok';
  } catch (e) { try { fs.rmSync(p + '.min-tmp', { force: true }); } catch {} out[p] = String(e && e.message || e).slice(0, 160); }
}
process.stdout.write(JSON.stringify(out));
"""


def minify_targets(paths):
    return [p for p in paths if MINIFY.fullmatch(p) and not p.endswith(".min.js")]


def strip_css(src):
    """CSS without comments (a /*! comment stays) and with runs of spacing cut to one space, none beside { } ; ,.
    Strings, escapes and spacing beside every other character (a descendant ':hover', calc's + and -) are kept."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i = j + 1
        elif c == "\\":
            out.append(src[i:i + 2])
            i += 2
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                out.append(src[i:])
                break
            out.append(src[i:j + 2] if src.startswith("/*!", i) else " ")
            i = j + 2
        elif c.isspace():
            while i < n and src[i].isspace():
                i += 1
            out.append(" ")
        else:
            out.append(c)
            i += 1
    text = "".join(out)
    # second pass: spacing runs again (a removed comment beside spacing) and none beside { } ; , outside strings
    res, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c in "\"'":
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == "\\" else 1
            res.append(text[i:j + 1])
            i = j + 1
            continue
        if c == "\\":
            res.append(text[i:i + 2])
            i += 2
            continue
        if c == " ":
            while i < n and text[i] == " ":
                i += 1
            prev = res[-1][-1:] if res else ""
            nxt = text[i:i + 1]
            if prev and nxt and prev not in "{};," and nxt not in "{};,":
                res.append(" ")
            continue
        res.append(c)
        i += 1
    return "".join(res).strip()


def _replace(path, data):
    """Write data to path through a new file: a hard link from stage() keeps pointing at the repository copy."""
    tmp = path + ".min-tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(data)
    os.replace(tmp, path)


def minify_published(dest, paths, terser=None):
    """Minify the staged copies of paths (relative to dest). terser: the terser package folder, or None to
    leave scripts as they are. -> {"before", "after", "js", "css", "kept": [(path, why)], "terser": bool}"""
    targets = minify_targets(paths)
    st = {"before": 0, "after": 0, "js": 0, "css": 0, "kept": [], "terser": False}
    sizes = {p: os.path.getsize(os.path.join(dest, p)) for p in targets}
    st["before"] = sum(sizes.values())
    for p in [t for t in targets if t.endswith(".css")]:
        full = os.path.join(dest, p)
        try:
            with open(full, encoding="utf-8") as f:
                src = f.read()
            _replace(full, strip_css(src))
            st["css"] += 1
        except (OSError, UnicodeDecodeError) as e:
            st["kept"].append((p, str(e)[:120]))
    js = [t for t in targets if t.endswith(".js")]
    main = None
    if terser:
        for cand in ("dist/bundle.min.js", "main.js"):
            if os.path.isfile(os.path.join(terser, cand)):
                main = os.path.join(os.path.abspath(terser), cand)
                break
    if js and main:
        files = [os.path.join(dest, p) for p in js]
        try:
            r = subprocess.run(["node", "--input-type=module", "-e", TERSER_JS], input=json.dumps(files), capture_output=True,
                               text=True, timeout=TERSER_TIMEOUT, env=dict(os.environ, TERSER_MAIN="file://" + main))
        except (OSError, subprocess.SubprocessError) as e:
            # no node, or terser too slow: publish the scripts as they are, never fail the deploy
            why = "node not found" if isinstance(e, FileNotFoundError) else "terser timed out" if isinstance(e, subprocess.TimeoutExpired) else "terser did not start"
            st["kept"] += [(p, why) for p in js]
            r = None
        if r is not None:
            try:
                res = json.loads(r.stdout or "{}")
            except ValueError:
                res = {}
            st["terser"] = r.returncode == 0 and bool(res)
            for p, full in zip(js, files):
                if res.get(full) == "ok":
                    st["js"] += 1
                else:
                    st["kept"].append((p, res.get(full) or ("terser did not run: " + (r.stderr or "").strip()[-120:])))
    elif js:
        st["kept"] += [(p, "no terser") for p in js]
    st["after"] = sum(os.path.getsize(os.path.join(dest, p)) for p in targets)
    return st


# Pages are compacted too (Nov 6): the published copy of every page leaves out HTML comments and the comments in its
# inline styles and scripts. Conditional comments stay; <pre> and <textarea> are left as they are; a script that
# cannot be rebuilt safely is published as it is. The repository files do not change.
RAW = re.compile(r"(<(script|style|pre|textarea)\b([^>]*)>)(.*?)(</\2\s*>)", re.S | re.I)
HTML_COMMENT = re.compile(r"<!--(?!\[if|>|->)(?:(?!-->).)*-->", re.S)
JS_TYPES = ("text/javascript", "application/javascript", "module")
INLINE_JS = r"""
const fs = await import('node:fs'); const vm = await import('node:vm');
const { minify } = await import(process.env.TERSER_MAIN);
const items = JSON.parse(fs.readFileSync(0, 'utf8')); const out = {};
for (const [id, code, mod] of items) {
  try {
    const r = await minify(code, { compress: false, mangle: false, module: !!mod, sourceMap: false, format: { comments: false } });
    if (typeof r.code !== 'string') throw new Error('no output');
    if (!mod) new vm.Script(r.code);
    out[id] = r.code;
  } catch (e) { out[id] = null; }
}
process.stdout.write(JSON.stringify(out));
"""


def _inline_js(attrs):
    """the script's own code is in the page (no src) and it is JavaScript; -> None, "script" or "module" """
    if re.search(r"\bsrc\s*=", attrs, re.I):
        return None
    m = re.search(r"\btype\s*=\s*[\"']?([^\"'\s>]+)", attrs, re.I)
    t = (m.group(1).lower() if m else "")
    if t and t not in JS_TYPES:
        return None
    return "module" if t == "module" else "script"


def strip_html(src, js=None):
    """A page without HTML comments (outside scripts, styles, pre and textarea), its inline styles through strip_css,
    and each inline script replaced by js[body] when js has one."""
    js = js or {}
    out, pos = [], 0
    for m in RAW.finditer(src):
        out.append(HTML_COMMENT.sub("", src[pos:m.start()]))
        tag, name, attrs, body, end = m.group(1), m.group(2).lower(), m.group(3), m.group(4), m.group(5)
        if name == "style":
            body = strip_css(body)
        elif name == "script" and js.get(body) is not None and _inline_js(attrs):
            body = js[body]
        out.append(tag + body + end)
        pos = m.end()
    out.append(HTML_COMMENT.sub("", src[pos:]))
    return "".join(out)


def compact_pages(dest, paths, terser=None):
    """strip_html over the staged copy of every .html in paths; inline scripts that carry a comment go through
    terser once each (no renaming, no rewriting, comments dropped). -> {"pages", "before", "after", "scripts", "kept"}"""
    pages = [p for p in paths if p.endswith(".html")]
    st = {"pages": 0, "before": 0, "after": 0, "scripts": 0, "kept": 0}
    texts = {}
    want = {}
    for p in pages:
        try:
            with open(os.path.join(dest, p), encoding="utf-8") as f:
                t = f.read()
        except (OSError, UnicodeDecodeError):
            continue
        texts[p] = t
        for m in RAW.finditer(t):
            kind = m.group(2).lower() == "script" and _inline_js(m.group(3))
            if kind and ("//" in m.group(4) or "/*" in m.group(4) or "<!--" in m.group(4)):
                want.setdefault(m.group(4), kind == "module")
    js = {}
    main = None
    if terser:
        for cand in ("dist/bundle.min.js", "main.js"):
            if os.path.isfile(os.path.join(terser, cand)):
                main = os.path.join(os.path.abspath(terser), cand)
                break
    if want and main:
        items = [[str(i), code, mod] for i, (code, mod) in enumerate(want.items())]
        try:
            r = subprocess.run(["node", "--input-type=module", "-e", INLINE_JS], input=json.dumps(items), capture_output=True,
                               text=True, timeout=TERSER_TIMEOUT, env=dict(os.environ, TERSER_MAIN="file://" + main))
            res = json.loads(r.stdout or "{}") if r.returncode == 0 else {}
        except (OSError, subprocess.SubprocessError, ValueError):
            res = {}
        for i, (code, _) in enumerate(want.items()):
            if res.get(str(i)) is not None:
                js[code] = res[str(i)]
        st["scripts"], st["kept"] = len(js), len(want) - len(js)
    else:
        st["kept"] = len(want)
    for p, t in texts.items():
        new = strip_html(t, js)
        st["before"] += len(t.encode("utf-8"))
        st["after"] += len(new.encode("utf-8"))
        if new != t:
            _replace(os.path.join(dest, p), new)
            st["pages"] += 1
    return st


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
    for bad in ('<script src="/scripts/x.js">', "fetch('/data/prf-stories/a.json')", '<a href="https://agsist' '.com/test/x.html">',
                "fetch(`/workers/a.js`)", '<link href="CLAUDE.md">'):
        ok(pat.search(bad), f"link into a left-out path caught: {bad}")
    for good in ('<script src="/components/x.js">', "<!-- written by scripts/build.py -->", "fetch('/data/prf/a.json')",
                 '<a href="/rain/scripts-of-rain.html">', "(scripts/inject_static_nav.py)"):
        ok(not pat.search(good), f"not a link into a left-out path: {good}")
    # this file is scanned in every dry run too: its own examples must not trip
    # the absolute-URL check (Oct 29: one did, and the deploy would have stopped)
    with open(os.path.abspath(__file__), encoding="utf-8") as f:
        own = [ln for ln in f if re.search(absolute_pattern(), ln)]
    ok(not own, f"pages_publish.py trips its own scan: {own[:1]}")
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
    # the published copy's minify step: CSS cases, and the repository file behind a hard link stays as it was
    for src, want in [("a :hover , b { color : red ; }", "a :hover,b{color : red;}"),
                      ("/* how */ .x { width: calc(1px + 2%) }", ".x{width: calc(1px + 2%)}"),
                      ('.q::before { content: "/* a */  ;  {" }', '.q::before{content: "/* a */  ;  {"}'),
                      ("/*! kept */\n.a{}", "/*! kept */ .a{}"), (".e\\{ x }", ".e\\{x}"), ("/* open", "/* open")]:
        ok(strip_css(src) == want, f"strip_css {src!r} -> {strip_css(src)!r}, want {want!r}")
    with tempfile.TemporaryDirectory() as d:
        repo, site = os.path.join(d, "repo"), os.path.join(d, "site")
        for rel, text in [("components/a.js", "/* how it works */\nvar a = 1;\n"), ("css/s.css", "/* how */ .a { color: red }\n"),
                          ("components/b.css", ".b { x: 1 }"), ("components/sub/c.css", "/* deep */"), ("index.html", "<!-- x -->")]:
            os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
            with open(os.path.join(repo, rel), "w") as f:
                f.write(text)
        keep = ["components/a.js", "css/s.css", "components/b.css", "components/sub/c.css", "index.html"]
        stage(repo, site, keep)
        m = minify_published(site, keep, None)
        rd = lambda root, rel: open(os.path.join(root, rel)).read()
        ok(rd(site, "css/s.css") == ".a{color: red}" and rd(site, "components/b.css") == ".b{x: 1}", "the staged style sheets are minified")
        ok(rd(repo, "css/s.css") == "/* how */ .a { color: red }\n", "the repository's style sheet is unchanged (hard link broken first)")
        ok(rd(site, "components/sub/c.css") == "/* deep */" and rd(site, "index.html") == "<!-- x -->", "only components/*.js|css and css/*.css")
        ok(m["css"] == 2 and m["js"] == 0 and m["kept"] == [("components/a.js", "no terser")] and rd(site, "components/a.js") == rd(repo, "components/a.js"),
           f"no terser: scripts publish as they are ({m})")
        ok(minify_targets(["components/x.min.js", "components/y.js", "css/z.css", "css/a/b.css", "js/c.js"]) == ["components/y.js", "css/z.css"],
           "targets: top-level components and css, no .min.js")
    # no node, or a terser that times out: the scripts publish as they are, with a warning, and the run goes on
    with tempfile.TemporaryDirectory() as d:
        site, tdir = os.path.join(d, "site"), os.path.join(d, "terser")
        os.makedirs(os.path.join(site, "components"))
        os.makedirs(tdir)
        for fp, text in [(os.path.join(site, "components", "a.js"), "/* c */ var a = 1;\n"), (os.path.join(tdir, "main.js"), "")]:
            with open(fp, "w") as f:
                f.write(text)
        old_path, old_to = os.environ.get("PATH", ""), TERSER_TIMEOUT
        try:
            os.environ["PATH"] = os.path.join(d, "nowhere")
            m = minify_published(site, ["components/a.js"], tdir)
            ok(m["js"] == 0 and m["kept"] == [("components/a.js", "node not found")], f"no node: published as it is ({m['kept']})")
        finally:
            os.environ["PATH"] = old_path
        node = shutil.which("node")
        if node:
            globals()["TERSER_TIMEOUT"] = 0.001
            try:
                m = minify_published(site, ["components/a.js"], tdir)
                ok(m["js"] == 0 and m["kept"] and m["kept"][0][0] == "components/a.js", f"slow terser: published as it is ({m['kept']})")
            finally:
                globals()["TERSER_TIMEOUT"] = old_to
        ok(open(os.path.join(site, "components", "a.js")).read() == "/* c */ var a = 1;\n", "the file is as it was after a fallback")
    ok(minify_targets(["sw.js", "sw.js.map", "x/sw.js"]) == ["sw.js"], "the service worker is a minify target")
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
        if "--minify" in argv:
            terser = argv[argv.index("--terser") + 1] if "--terser" in argv and argv.index("--terser") + 1 < len(argv) else None
            m = minify_published(dest, r["keep"], terser)
            print(f"minified {m['js']} scripts and {m['css']} style sheets: {m['before']:,} bytes to {m['after']:,}"
                  f" ({m['before'] - m['after']:,} saved)")
            if m["kept"]:
                print(f"::warning::{len(m['kept'])} file(s) published as they are (not minified), e.g. {m['kept'][0][0]}")
            c = compact_pages(dest, r["keep"], terser)
            print(f"compacted {c['pages']} pages ({c['scripts']} inline scripts): {c['before']:,} bytes to {c['after']:,}"
                  + (f"; {c['kept']} inline script(s) published as they are" if c["kept"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
