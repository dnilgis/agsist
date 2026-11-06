#!/usr/bin/env python3
"""share_host.py: where the share images live (Nov 4, 2026; growth plan, phase 1).

WHY. The share images (og:image, twitter:image) are 68 MB of the published site: the Farmland Atlas cards
(farmland-atlas/og/, 3,202 PNGs) and the Daily cards (data/social/, one JPG a day). Sig's Nov 4 decision: three
repos, one job each; the public repo dnilgis/agsist-data serves files that pages point at, from
https://dnilgis.github.io/agsist-data/ at the same paths. Social sites accept an og:image on another host.

THE ORDER (a page must never point at an image that is not there), as it ran:
  1. the producers copied their folder to agsist-data on every run, while the files also stayed here (#327);
  2. a one-time seed job (agsist-data-seed.yml, run 41910531691 on Nov 4, then removed) copied each folder,
     waited until a sample of its URLs answered with the same bytes as here, and only then listed the folder
     in data/share-host.json and rewrote the committed pages (flip, commit e65dff9cb78);
  3. the builders read data/share-host.json through url(), so every rebuild keeps the new host;
  4. the files left this repository (fx/datarepo2): the Atlas cards are drawn into an agsist-data checkout
     (farmland-atlas-pages.yml) and the Daily card is drawn outside the checkout and added there (daily.yml).

THE GUARD (check, test/share-host.test.mjs): no committed page names a listed folder on agsist.com, no
builder (scripts/*.py) spells either folder's agsist.com URL at all (they go through url()), and no file of a
listed folder is in this repository again.
cron_health.py's agsist-data-images row fetches the og:image of a few pages once a day and goes red on a 404.

    python3 scripts/share_host.py seeded                  folders served from agsist-data now
    python3 scripts/share_host.py mark FOLDER...          list folders in data/share-host.json (the seed job)
    python3 scripts/share_host.py flip [--list]           rewrite committed pages for the listed folders
    python3 scripts/share_host.py check                   the guard; exit 1 on a hit
    python3 scripts/share_host.py verify FOLDER... [--wait SECONDS]   the seed job: copies answer, same bytes
    python3 scripts/share_host.py wait [PAGE] [--wait SECONDS]   daily.yml: the page's og:image answers (best effort)
    python3 scripts/share_host.py --selftest
  --root DIR  works on another checkout (the seed job flips a fresh worktree of main).
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://agsist.com"
HOST = "https://dnilgis.github.io/agsist-data"
FOLDERS = ("farmland-atlas/og", "data/social")
MARKER = "data/share-host.json"
# folders never searched for pages (code, tests, the engine overlay, the image folders themselves)
SKIP_DIRS = {".git", ".github", "node_modules", "scripts", "test", "build", "vendor", "workers", ".engine-src", ".verify"}
PAGE_EXT = (".html", ".xml", ".txt", ".json")
# the pages whose share image the daily row fetches: the home page (today's Daily card), the Atlas hub,
# one state and one county, the data page; plus the newest Daily issue (found below)
SAMPLE_PAGES = ("index.html", "farmland-atlas/states/index.html", "farmland-atlas/iowa/index.html",
                "farmland-atlas/iowa/story-county.html", "farmland-atlas/data.html")
UA = "agsist-share-check/1 (+https://agsist.com)"

_cache = {}


def seeded(root=None):
    """the folders listed in data/share-host.json (served from agsist-data). A missing or broken file lists
    none: every image stays on agsist.com."""
    root = root or ROOT
    if root in _cache:
        return _cache[root]
    try:
        doc = json.load(open(os.path.join(root, MARKER), encoding="utf-8"))
        got = tuple(f for f in FOLDERS if f in (doc.get("folders") or {}))
    except Exception:
        got = ()
    _cache[root] = got
    return got


def _under(path, folder):
    return path.startswith(folder + "/")


def url(path, root=None):
    """a site path ('/farmland-atlas/og/19169.png?v=1' or 'data/social/card-2026-11-04.jpg') as the full URL a
    page should carry: agsist-data for a listed folder, agsist.com for anything else."""
    p = str(path).lstrip("/")
    for f in seeded(root):
        if _under(p, f):
            return HOST + "/" + p
    return SITE + "/" + p


def local(u):
    """a share image URL on either host -> its path in this repository (no query), or None"""
    for base in (SITE, HOST):
        if str(u).startswith(base + "/"):
            return str(u)[len(base) + 1:].split("?")[0].split("#")[0]
    return None


def old_prefix(folder):
    return SITE + "/" + folder + "/"


def new_prefix(folder):
    return HOST + "/" + folder + "/"


def _git_grep(root, needle):
    """committed or working-tree files under root that contain needle (a fixed string), skipping SKIP_DIRS"""
    try:
        out = subprocess.run(["git", "-C", root, "grep", "-l", "-F", "--untracked", "-e", needle],
                             capture_output=True, text=True, timeout=300)
    except Exception:
        out = None
    if out is not None and out.returncode in (0, 1):
        files = [f for f in out.stdout.splitlines() if f]
    else:  # not a git checkout (a test folder): walk it
        files = []
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d not in SKIP_DIRS]
            for fn in fns:
                fp = os.path.join(dp, fn)
                try:
                    if needle in open(fp, encoding="utf-8", errors="ignore").read():
                        files.append(os.path.relpath(fp, root).replace(os.sep, "/"))
                except OSError:
                    pass
    return sorted(f for f in files if f.split("/")[0] not in SKIP_DIRS)


def page_hits(root=None, folders=None):
    """{file: [folder, ...]}: pages (html, xml, txt, json outside code folders) that name a folder on agsist.com"""
    root = root or ROOT
    hits = {}
    for f in (seeded(root) if folders is None else folders):
        for rel in _git_grep(root, old_prefix(f)):
            if rel.endswith(PAGE_EXT) and rel != MARKER:
                hits.setdefault(rel, []).append(f)
    return hits


# scripts that may name a share folder as a path in this repository, and why. Everywhere else a builder
# names the folders only through url() (a line that calls url( is fine).
BUILDER_ALLOW = {
    "build_atlas_cards.py": "draws the Atlas cards into farmland-atlas/og",
    "build_social_card.py": "draws the Daily cards into data/social",
    "build_share_images.py": "its docstring lists where each set's card lives",
    "generated_sets.py": "the set table names farmland-atlas/og as the atlas-cards output",
    "cron_health.py": "its selftest writes a fixture page on the agsist-data host",
}
_BARE = re.compile(r"farmland-atlas/og\b|data/social\b")
# a share card URL put together on agsist.com: SITE + "/farmland-atlas/og/..", f"{SITE}/..", "/%s/og/" % OUT
_ON_SITE = re.compile(r"(\bSITE\b|agsist\.com)[^\n]*?(?<!img)/(?:%s|\{[^}]*\}|farmland-atlas)/og/|"
                      r"(\bSITE\b|agsist\.com)[^\n]*?(data/social|social/card)")


def _code(line):
    """the line without a trailing # comment (a # inside a string is kept: good enough for this check)"""
    i = line.find("#")
    while i >= 0:
        before = line[:i]
        if before.count('"') % 2 == 0 and before.count("'") % 2 == 0:
            return before
        i = line.find("#", i + 1)
    return line


def builder_hits(root=None):
    """scripts/*.py (other than this file) that put a share card URL together on agsist.com, or that name a
    share folder outside url() and outside BUILDER_ALLOW"""
    root = root or ROOT
    out = []
    sd = os.path.join(root, "scripts")
    for fn in sorted(os.listdir(sd)) if os.path.isdir(sd) else []:
        if not fn.endswith(".py") or fn == "share_host.py":
            continue
        lines = open(os.path.join(sd, fn), encoding="utf-8", errors="ignore").read().splitlines()
        for n, line in enumerate(lines, 1):
            code = _code(line)
            if _ON_SITE.search(code) or ("agsist.com/" in code and _BARE.search(code)):
                out.append("scripts/%s:%d builds a share card URL on agsist.com (use share_host.url())" % (fn, n))
            elif fn not in BUILDER_ALLOW and _BARE.search(code) and "url(" not in code \
                    and not code.strip().startswith(("#", '"""')):
                out.append("scripts/%s:%d names a share folder outside share_host.url() (or add it to "
                           "BUILDER_ALLOW with a reason)" % (fn, n))
    return out


def kept_files(root=None):
    """files of a listed folder that are in this repository again (they live in agsist-data now)"""
    root = root or ROOT
    out = []
    for f in seeded(root):
        try:
            r = subprocess.run(["git", "-C", root, "ls-files", "--", f], capture_output=True, text=True, timeout=60)
            files = [x for x in r.stdout.splitlines() if x] if r.returncode == 0 else None
        except Exception:
            files = None
        if files is None:  # not a git checkout (a test folder): look at the disk
            d = os.path.join(root, f)
            files = [f + "/" + x for x in sorted(os.listdir(d))] if os.path.isdir(d) else []
        if files:
            out.append("%d files of %s are in this repository (%s ...): the share images live in agsist-data"
                       % (len(files), f, files[0]))
    return out


def check(root=None):
    """the guard: [] when every listed folder is named only on agsist-data, and no builder hard-codes one"""
    bad = builder_hits(root) + kept_files(root)
    for rel, fs in sorted(page_hits(root).items()):
        bad.append("%s names %s on agsist.com (served from agsist-data since data/share-host.json lists it)"
                   % (rel, ", ".join(fs)))
    return bad


def mark(folders, root=None, now=None):
    """list folders in data/share-host.json with the time they were verified"""
    root = root or ROOT
    p = os.path.join(root, MARKER)
    try:
        doc = json.load(open(p, encoding="utf-8"))
    except Exception:
        doc = {}
    doc.setdefault("host", HOST)
    doc.setdefault("note", "A listed folder's share images are served from the host.")
    fs = doc.setdefault("folders", {})
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for f in folders:
        if f not in FOLDERS:
            raise SystemExit("not a share image folder: %s (known: %s)" % (f, ", ".join(FOLDERS)))
        fs.setdefault(f, stamp)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    _cache.pop(root, None)
    return doc


def flip(root=None):
    """rewrite every page that names a listed folder on agsist.com; returns the files changed"""
    root = root or ROOT
    changed = []
    for rel, fs in sorted(page_hits(root).items()):
        fp = os.path.join(root, rel)
        txt = open(fp, encoding="utf-8").read()
        new = txt
        for f in fs:
            new = new.replace(old_prefix(f), new_prefix(f))
        if new != txt:
            with open(fp, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            changed.append(rel)
    return changed


# ── verify (the seed job) and the daily row ─────────────────────────────────────
def _fetch(u, method="GET", timeout=30):
    req = urllib.request.Request(u, method=method, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, (r.read() if method == "GET" else b"")
    except urllib.error.HTTPError as e:
        return e.code, b""


def sample_files(folder, root=None, n=6):
    """a spread of files in a folder of this checkout: first, last, newest names, and a few between"""
    root = root or ROOT
    d = os.path.join(root, folder)
    names = sorted(x for x in os.listdir(d) if not x.startswith(".")) if os.path.isdir(d) else []
    if not names:
        return []
    pick = {names[0], names[-1]}
    for i in range(1, n - 1):
        pick.add(names[(len(names) * i) // (n - 1)])
    for keep in ("hub.png", "stamps.json", "card-latest.jpg"):
        if keep in names:
            pick.add(keep)
    return [folder + "/" + x for x in sorted(pick)]


def verify(folders, root=None, wait=0, get=None, sleep=time.sleep):
    """each sampled file answers 200 on agsist-data with the same bytes as here. Polls until wait seconds have
    passed (Pages takes a few minutes to publish a push). -> (ok, lines)"""
    root = root or ROOT
    get = get or _fetch
    files = [p for f in folders for p in sample_files(f, root)]
    if not files:
        return False, ["nothing to verify: no files in %s" % ", ".join(folders)]
    want = {p: hashlib.sha1(open(os.path.join(root, p), "rb").read()).hexdigest() for p in files}
    deadline = time.time() + wait
    while True:
        lines, ok = [], True
        for p in files:
            st, body = get(HOST + "/" + p)
            same = st == 200 and hashlib.sha1(body).hexdigest() == want[p]
            ok = ok and same
            lines.append("%s %s %s" % ("ok  " if same else "MISS", st, HOST + "/" + p))
        if ok or time.time() >= deadline:
            return ok, lines
        sleep(30)


def wait_page(rel, root=None, wait=150, get=None, sleep=time.sleep, clock=time.time):
    """daily.yml, after the copy: wait until the og:image a page names answers 200 when it is on agsist-data,
    so the issue does not go live before its card is served. Best effort: -> (ok, message), never raises."""
    root = root or ROOT
    try:
        h = open(os.path.join(root, rel), encoding="utf-8", errors="ignore").read()
    except OSError as e:
        return False, "could not read %s: %s" % (rel, e)
    m = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', h)
    if not m or not m.group(1).startswith(HOST + "/"):
        return True, "%s does not name an agsist-data image; nothing to wait for" % rel
    u = m.group(1)
    get = get or (lambda x: _fetch(x, method="HEAD", timeout=20))
    deadline = clock() + wait
    last = None
    while True:
        try:
            last = get(u)[0]
        except Exception as e:
            last = type(e).__name__
        if last == 200:
            return True, "%s answers 200" % u
        if clock() >= deadline:
            return False, "%s still answers %s after %d s" % (u, last, wait)
        sleep(10)


def newest_daily(root=None):
    root = root or ROOT
    d = os.path.join(root, "daily")
    names = sorted(x for x in os.listdir(d) if re.match(r"^\d{4}-\d\d-\d\d\.html$", x)) if os.path.isdir(d) else []
    return "daily/" + names[-1] if names else None


def sample_urls(root=None):
    """the og:image of SAMPLE_PAGES and the newest Daily issue, where it is on agsist-data"""
    root = root or ROOT
    out = []
    pages = list(SAMPLE_PAGES) + [p for p in [newest_daily(root)] if p]
    for rel in pages:
        try:
            h = open(os.path.join(root, rel), encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        m = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', h)
        if m and m.group(1).startswith(HOST + "/") and m.group(1) not in out:
            out.append(m.group(1))
    return out


def row(now, prev=None, root=None, get=None):
    """the cron-health row 'agsist-data-images'. Once a day (or every run while it is red) it asks for the og:image
    of a few pages that point at agsist-data; a 404 is late (red). Before any folder is listed it is an
    info row. prev: the row from the last saved cron-health.json."""
    root = root or ROOT
    base = {"workflow": "agsist-data-images", "clock": "share images on %s answer, checked once a day" % HOST}
    if not seeded(root):
        return dict(base, critical=False, status="ok", why="no share image is served from agsist-data yet")
    base["critical"] = True
    try:
        last = datetime.strptime((prev or {}).get("checked_at", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        last = None
    if prev and prev.get("status") == "ok" and last and (now - last).total_seconds() < 23 * 3600:
        return dict(prev)
    urls = sample_urls(root)
    if not urls:
        return dict(base, status="late", checked_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    why="data/share-host.json lists %s but no sampled page points at agsist-data"
                    % ", ".join(seeded(root)))
    get = get or (lambda u: _fetch(u, method="HEAD", timeout=20))
    missing, unknown = [], []
    for u in urls:
        try:
            st, _ = get(u)
        except Exception as e:
            unknown.append("%s (%s)" % (u, type(e).__name__))
            continue
        if st != 200:
            missing.append("%s answers %s" % (u, st))
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if missing:
        return dict(base, status="late", checked_at=stamp, why="; ".join(missing[:4]))
    if unknown:
        return dict(base, status="unknown", checked_at=stamp, why="could not ask: " + "; ".join(unknown[:3]))
    return dict(base, status="ok", checked_at=stamp, why="%d share image%s answer 200: %s" % (len(urls), "" if len(urls) == 1 else "s",
                                                                  ", ".join(u[len(HOST) + 1:].split("?")[0] for u in urls)))


# ── selftest ───────────────────────────────────────────────────────────────────
def selftest():
    import shutil
    import tempfile
    fails = []

    def ok(cond, what):
        if not cond:
            fails.append(what)

    tmp = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(tmp, "data", "social"))
        os.makedirs(os.path.join(tmp, "farmland-atlas", "og"))
        os.makedirs(os.path.join(tmp, "daily"))
        os.makedirs(os.path.join(tmp, "scripts"))
        for n in ("card-2026-11-03.jpg", "card-2026-11-04.jpg", "card-latest.jpg"):
            open(os.path.join(tmp, "data", "social", n), "wb").write(n.encode())
        open(os.path.join(tmp, "farmland-atlas", "og", "hub.png"), "wb").write(b"hub")
        page = ('<meta property="og:image" content="https://agsist.com/data/social/card-2026-11-04.jpg">\n'
                '<meta name="twitter:image" content="https://agsist.com/data/social/card-2026-11-04.jpg">\n'
                '{"image":[{"url":"https://agsist.com/data/social/card-2026-11-04.jpg"}]}\n'
                '<img src="/img/og/agsist.jpg"> https://agsist.com/farmland-atlas/og/hub.png?v=1\n')
        open(os.path.join(tmp, "daily", "2026-11-04.html"), "w").write(page)
        open(os.path.join(tmp, "index.html"), "w").write(page)
        open(os.path.join(tmp, "scripts", "x.py"), "w").write('U = "https://agsist.com/data/social/card-"\n')

        ok(seeded(tmp) == (), "no marker: nothing is seeded")
        ok(url("/data/social/card-2026-11-04.jpg", tmp) == SITE + "/data/social/card-2026-11-04.jpg",
           "before the seed the card stays on agsist.com")
        ok(check(tmp) == ["scripts/x.py:1 builds a share card URL on agsist.com (use share_host.url())"],
           "before the seed only a hard-coded builder URL is a hit: %r" % check(tmp))
        # the forms a checker tried (Nov 4): SITE + "/farmland-atlas/og/..", an f-string, a bare folder path
        forms = {
            "a.py": 'IMG = SITE + "/farmland-atlas/og/" + f + ".png"\n',
            "b.py": 'IMG = f"{SITE}/farmland-atlas/og/{f}.png"\n',
            "c.py": 'IMG = SITE + "/%s/og/%s.png" % (OUT, f)\n',
            "d.py": 'CARD = os.path.join("data/social", name)\n',
            "e.py": 'IMG = f"{SITE}/data/social/card-{d}.jpg"\n',
            "f.py": '# farmland-atlas/og/ in a comment\nU = share_host.url("data/social/card-")\nX = SITE + "/img/og/a.jpg"\n',
        }
        for fn, body in forms.items():
            open(os.path.join(tmp, "scripts", fn), "w").write(body)
        got = check(tmp)
        for fn in ("a.py", "b.py", "c.py", "d.py", "e.py"):
            ok(any(g.startswith("scripts/%s:1 " % fn) for g in got), "the guard catches %s: %r" % (fn, forms[fn]))
        ok(not any("f.py" in g for g in got), "a comment, a url() call and img/og are fine: %r" % got)
        open(os.path.join(tmp, "scripts", "build_social_card.py"), "w").write('OUT = "data/social"\n')
        ok(not any("build_social_card" in g for g in check(tmp)), "an allowed writer may name its folder")
        for fn in list(forms) + ["build_social_card.py"]:
            os.remove(os.path.join(tmp, "scripts", fn))
        os.remove(os.path.join(tmp, "scripts", "x.py"))
        ok(check(tmp) == [], "before the seed the pages are fine")

        mark(["data/social"], tmp, now=datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc))
        ok(seeded(tmp) == ("data/social",), "mark lists the folder")
        ok(url("data/social/card-2026-11-04.jpg", tmp) == HOST + "/data/social/card-2026-11-04.jpg",
           "after the seed the card is on agsist-data")
        ok(url("/farmland-atlas/og/hub.png?v=1", tmp) == SITE + "/farmland-atlas/og/hub.png?v=1",
           "a folder not listed stays on agsist.com")
        ok(url("/data/socialist.jpg", tmp) == SITE + "/data/socialist.jpg", "a lookalike path is not the folder")
        ok(any("3 files of data/social" in b for b in check(tmp)), "files of a listed folder kept here are a hit")
        keep = [b for b in check(tmp) if " files of " not in b]
        bad = keep
        ok(len(bad) == 2 and all("data/social" in b for b in bad), "after the seed the old pages are hits: %r" % bad)
        ok(sorted(flip(tmp)) == ["daily/2026-11-04.html", "index.html"], "flip rewrites both pages")
        ok([b for b in check(tmp) if " files of " not in b] == [], "after the flip the guard passes: %r" % check(tmp))
        h = open(os.path.join(tmp, "index.html")).read()
        ok(h.count(HOST + "/data/social/card-2026-11-04.jpg") == 3, "og, twitter and JSON-LD all move")
        ok(SITE + "/farmland-atlas/og/hub.png?v=1" in h and "/img/og/agsist.jpg" in h, "other images stay")
        ok(flip(tmp) == [], "flip is idempotent")
        mark(["data/social"], tmp, now=datetime(2026, 12, 1, tzinfo=timezone.utc))
        ok(json.load(open(os.path.join(tmp, MARKER)))["folders"]["data/social"] == "2026-11-05T03:00:00Z",
           "a second mark keeps the first date")
        ok(local(HOST + "/data/social/card-2026-11-04.jpg?x=1") == "data/social/card-2026-11-04.jpg", "local() maps the host")
        ok(local(SITE + "/img/og/agsist.jpg") == "img/og/agsist.jpg", "local() maps agsist.com")
        ok(local("https://example.com/a.jpg") is None, "local() of another host is None")

        # verify: same bytes or it is a miss; polls until the copies answer
        served = {}

        def get(u):
            p = u[len(HOST) + 1:]
            return (200, served[p]) if p in served else (404, b"")
        res, lines = verify(["data/social"], tmp, wait=0, get=get)
        ok(not res and all(x.startswith("MISS 404") for x in lines), "nothing served yet: a miss")
        for n in ("card-2026-11-03.jpg", "card-2026-11-04.jpg", "card-latest.jpg"):
            served["data/social/" + n] = n.encode()
        served["data/social/card-latest.jpg"] = b"old"
        res, lines = verify(["data/social"], tmp, wait=0, get=get)
        ok(not res and any("MISS 200" in x and "card-latest" in x for x in lines), "a different file is a miss")
        served["data/social/card-latest.jpg"] = b"card-latest.jpg"
        ok(verify(["data/social"], tmp, wait=0, get=get)[0], "the same bytes pass")

        # the cron-health row
        now = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)
        r = row(now, None, tmp, get=lambda u: (200, b""))
        ok(r["status"] == "ok" and r["critical"] and "1 share image answer 200" in r["why"], "row ok: %r" % r)
        r404 = row(now, None, tmp, get=lambda u: (404, b""))
        ok(r404["status"] == "late" and "404" in r404["why"], "a 404 is late (red): %r" % r404)
        again = row(now.replace(hour=20), r, tmp, get=lambda u: (404, b""))
        ok(again == r, "an ok row is reused within the day (one check a day)")
        nextday = row(datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc), r, tmp, get=lambda u: (404, b""))
        ok(nextday["status"] == "late", "the next day it checks again")
        red = row(now.replace(hour=13), r404, tmp, get=lambda u: (200, b""))
        ok(red["status"] == "ok", "a red row is checked again on every run, so it clears")

        def boom(u):
            raise OSError("down")
        ok(row(now, None, tmp, get=boom)["status"] == "unknown", "no answer at all is unknown, not red")
        os.remove(os.path.join(tmp, MARKER))
        _cache.pop(tmp, None)
        r0 = row(now, None, tmp)
        ok(r0["status"] == "ok" and not r0["critical"], "before the seed the row is info only")
        ok(newest_daily(tmp) == "daily/2026-11-04.html", "newest Daily issue")

        # wait_page: nothing to wait for before the flip; polls after it; gives up with a message
        open(os.path.join(tmp, "index.html"), "w").write('<meta property="og:image" content="%s/data/social/card-x.jpg">' % SITE)
        ok(wait_page("index.html", tmp, wait=0, get=lambda u: (404, b""))[0], "an agsist.com image needs no wait")
        flip_page = '<meta property="og:image" content="%s/data/social/card-x.jpg">' % HOST
        open(os.path.join(tmp, "index.html"), "w").write(flip_page)
        answers = iter([404, 404, 200])
        t = [0]
        res = wait_page("index.html", tmp, wait=60, get=lambda u: (next(answers), b""),
                        sleep=lambda n: t.__setitem__(0, t[0] + n), clock=lambda: t[0])
        ok(res[0] and t[0] == 20, "polls until the card answers: %r %r" % (res, t))
        t = [0]
        res = wait_page("index.html", tmp, wait=30, get=lambda u: (404, b""),
                        sleep=lambda n: t.__setitem__(0, t[0] + n), clock=lambda: t[0])
        ok(not res[0] and "404" in res[1] and t[0] == 30, "gives up at the deadline: %r" % (res,))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # the real repository: the marker (if any) is readable and the guard passes
    real = check()
    ok(real == [], "this checkout passes the guard: %r" % real[:5])
    for f in fails:
        print("FAIL: " + f)
    print("share_host selftest: %s" % ("OK" if not fails else "%d failed" % len(fails)))
    return 1 if fails else 0


def main(argv):
    root = None
    if "--root" in argv:
        i = argv.index("--root")
        root = os.path.abspath(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    if cmd == "--selftest":
        return selftest()
    if cmd == "seeded":
        print(" ".join(seeded(root)))
        return 0
    if cmd == "mark":
        if not rest:
            print("mark: name the folders", file=sys.stderr)
            return 2
        mark(rest, root)
        print("listed: %s" % " ".join(seeded(root)))
        return 0
    if cmd == "flip":
        changed = flip(root)
        if "--list" in rest:
            print("\n".join(changed))
        else:
            print("flip: %d files rewritten for %s" % (len(changed), " ".join(seeded(root)) or "no folder"))
        return 0
    if cmd == "check":
        bad = check(root)
        for b in bad[:40]:
            print("FAIL " + b)
        if len(bad) > 40:
            print("... and %d more" % (len(bad) - 40))
        print("share_host check: %s" % ("OK" if not bad else "%d problems" % len(bad)))
        return 1 if bad else 0
    if cmd == "wait":
        # best effort: always exits 0; a card that never answers is one warning line
        wait = 150
        if "--wait" in rest:
            i = rest.index("--wait")
            wait = int(rest[i + 1])
            rest = rest[:i] + rest[i + 2:]
        res, msg = wait_page(rest[0] if rest else "index.html", root, wait=wait)
        print(msg if res else "::warning::share card not served yet: " + msg)
        return 0
    if cmd == "verify":
        wait = 0
        if "--wait" in rest:
            i = rest.index("--wait")
            wait = int(rest[i + 1])
            rest = rest[:i] + rest[i + 2:]
        folders = rest or list(FOLDERS)
        res, lines = verify(folders, root, wait=wait)
        print("\n".join(lines))
        print("verify: %s" % ("every sampled copy answers with the same bytes" if res else "copies missing or different"))
        return 0 if res else 1
    print("unknown command: %s" % cmd, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
