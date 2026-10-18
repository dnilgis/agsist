#!/usr/bin/env python3
"""Pointer pages: what a generated page leaves behind when its item drops out of the set.

A town, county or state that leaves the data used to take its page with it, and
the URL turned into a 404 that search engines and bookmarks still had. Now the
file stays as a pointer: under 1.5 KB, noindex, canonical to the parent page, an
instant meta refresh to it, and one plain line with a link for no-JS readers and
screen readers. Pointers stay out of every sitemap, llms.txt and the search index
(they are noindex and redirect stubs, which those builders already skip).

Each set keeps a manifest at data/pointers/<set>.json: {file path: {"to": url,
"since": date}}. One file per set so two workflows never fight over one file.
data/pointers/site.json holds hand-retired pages (no generator owns them).

A generator calls settle() after it has written its real pages, with every file
it owns on disk that it did not write this run. Real pages among them become
pointers, old pointers stay (re-aimed if their parent is gone), and a pointer
whose item came back is simply overwritten by the real page and leaves the
manifest. Generators must never delete a pointer: is_pointer() tells them apart.

  python3 scripts/pointer_pages.py --selftest
"""
import datetime
import html
import json
import os
import re
import sys

ORIGIN = "https://agsist.com"
MARKER = "agsist-pointer"          # <meta name="agsist-pointer" content="/target">
MAX_BYTES = 1536
MANIFEST_DIR = os.path.join("data", "pointers")
_RE_MARK = re.compile(r'<meta name="' + MARKER + r'" content="([^"]*)">')
_SMALL = {"and", "of", "the", "de", "la", "du"}


def label(slug):
    """'yakutat-city-and-borough' -> 'Yakutat City and Borough'."""
    slug = os.path.basename(slug)
    if slug.endswith(".html"):
        slug = slug[:-5]
    ws = [w for w in slug.split("-") if w]
    return " ".join(w if (i and w in _SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(ws))


def url_of(rel):
    """File path -> the site's clean URL path (/x for x.html, /x/ for x/index.html)."""
    rel = rel.replace(os.sep, "/")
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + (rel[:-5] if rel.endswith(".html") else rel)


def file_of(url):
    """Clean URL path -> candidate file paths, in the order Pages tries them."""
    p = url.split("#", 1)[0].split("?", 1)[0].lstrip("/")
    if p == "" or p.endswith("/"):
        return [p + "index.html"]
    return [p + ".html", p + "/index.html"]


def page(to, name, parent, line=None):
    """The pointer page. to: the parent's URL path; name: what moved; parent: the parent page's name."""
    e = html.escape
    say = line or f"This page moved. {e(name)} is now covered on the <a href=\"{e(to)}\">{e(parent)} page</a>."
    if line:
        say = say.replace("{link}", f'<a href="{e(to)}">{e(parent)} page</a>')
    return ("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            f"<title>{e(name)}: moved | AGSIST</title>\n"
            "<meta name=\"robots\" content=\"noindex, follow\">\n"
            f"<meta name=\"{MARKER}\" content=\"{e(to)}\">\n"
            f"<link rel=\"canonical\" href=\"{ORIGIN}{e(to)}\">\n"
            f"<meta http-equiv=\"refresh\" content=\"0; url={e(to)}\">\n"
            "</head>\n<body style=\"margin:0;background:#fff;color:#111\">\n"
            "<main style=\"max-width:600px;margin:0 auto;padding:3rem 1rem;font-family:system-ui,sans-serif\">\n"
            f"<p>{say}</p>\n</main>\n</body>\n</html>\n")


def pointer_target(text):
    """The target URL if this text is a pointer page, else None."""
    m = _RE_MARK.search(text[:MAX_BYTES * 2])
    return html.unescape(m.group(1)) if m else None


def is_pointer(path):
    try:
        with open(path, "rb") as f:
            head = f.read(MAX_BYTES * 2).decode("utf-8", "replace")
    except OSError:
        return False
    return pointer_target(head) is not None


def manifest_file(root, set_name):
    return os.path.join(root, MANIFEST_DIR, set_name + ".json")


def load(root, set_name):
    try:
        with open(manifest_file(root, set_name), encoding="utf-8") as f:
            return json.load(f).get("pointers", {})
    except (OSError, ValueError):
        return {}


def load_all(root):
    out = {}
    d = os.path.join(root, MANIFEST_DIR)
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json"):
                out.update(load(root, fn[:-5]))
    return out


def _dump(m):
    return json.dumps({"about": "Pointer pages left where a generated page dropped out of its set "
                                "(scripts/pointer_pages.py). path: file; to: where it sends readers; since: date retired.",
                       "pointers": {k: m[k] for k in sorted(m)}}, indent=1) + "\n"


def real_page(root, rel):
    p = os.path.join(root, rel)
    return os.path.isfile(p) and not is_pointer(p)


def resolve(root, cands, real=None):
    """First (url, parent name) whose file is a real page; the last one is the fallback."""
    real = real or (lambda rel: real_page(root, rel))
    for url, nm in cands:
        if any(real(f) for f in file_of(url)):
            return url, nm
    return cands[-1]


def settle(root, set_name, gone, target_for, real=None, check=False, today=None, name_for=None):
    """Turn every page in gone (files under root this build owns but did not write this run, real
    pages or old pointers) into a pointer, and bring the set's manifest in line.

    target_for(rel) -> [(url, parent name), ...] best first; the first that is a real page wins
    (so a county whose state page also left points at the hub). real(rel) says whether a file will
    be a real page after this build (default: what is on disk now). Never deletes anything.
    check=True writes nothing and returns what would change. Returns the changed paths."""
    today = today or datetime.date.today().isoformat()
    old = load(root, set_name)
    new, changed = {}, []
    for rel in sorted(set(gone)):
        rel = rel.replace(os.sep, "/")
        to, parent = resolve(root, target_for(rel), real)
        body = page(to, (name_for or label)(rel), parent)
        p = os.path.join(root, rel)
        have = None
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                have = f.read()
        was_pointer = have is not None and pointer_target(have) is not None
        since = old[rel]["since"] if (rel in old and was_pointer) else today
        new[rel] = {"to": to, "since": since}
        if have != body:
            changed.append(rel)
            if not check:
                os.makedirs(os.path.dirname(p) or root, exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(body)
    mf = manifest_file(root, set_name)
    if new != old:
        rel_mf = os.path.relpath(mf, root).replace(os.sep, "/")
        if check:
            if {k: v["to"] for k, v in new.items()} != {k: v["to"] for k, v in old.items()}:
                changed.append(rel_mf)
        else:
            if new or os.path.exists(mf):
                os.makedirs(os.path.dirname(mf), exist_ok=True)
                with open(mf, "w", encoding="utf-8") as f:
                    f.write(_dump(new))
            changed.append(rel_mf)
    return changed


def problems(root):
    """Every pointer listed must be a pointer on disk, small, aimed where the manifest says, at a real page."""
    bad = []
    for rel, e in sorted(load_all(root).items()):
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            bad.append(f"{rel}: in data/pointers but no file")
            continue
        with open(p, encoding="utf-8", errors="replace") as f:
            t = f.read()
        to = pointer_target(t)
        if to is None:
            if os.path.getsize(p) <= MAX_BYTES:
                bad.append(f"{rel}: in data/pointers but not a pointer page")
            continue     # a real page came back and the manifest has not caught up; the generator drops it
        if to != e.get("to"):
            bad.append(f"{rel}: points at {to}, manifest says {e.get('to')}")
        if not any(real_page(root, f) for f in file_of(to)):
            bad.append(f"{rel}: target {to} is not a real page")
    return bad


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    with tempfile.TemporaryDirectory() as d:
        def w(rel, s):
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w").write(s)
        w("rain.html", "<title>hub</title>")
        w("rain/iowa.html", "<title>Iowa</title>")
        w("rain/iowa/story-county.html", "<title>real</title>" + "x" * 3000)
        w("rain/maine/york-county.html", "<title>real</title>")

        def tf(rel):
            st = rel.split("/")[1]
            return [(f"/rain/{st}", label(st)), ("/rain", "Rain")]
        ch = settle(d, "rain", ["rain/iowa/story-county.html", "rain/maine/york-county.html"], tf, today="2026-10-18")
        ok(set(ch) == {"rain/iowa/story-county.html", "rain/maine/york-county.html", "data/pointers/rain.json"}, f"changed {ch}")
        t = open(os.path.join(d, "rain/iowa/story-county.html")).read()
        ok(len(t.encode()) <= MAX_BYTES, f"pointer is {len(t.encode())} bytes")
        ok('<meta name="robots" content="noindex, follow">' in t, "noindex")
        ok('<link rel="canonical" href="https://agsist.com/rain/iowa">' in t, "canonical to the state page")
        ok('content="0; url=/rain/iowa"' in t, "refresh to the state page")
        ok("Story County is now covered on the <a href=\"/rain/iowa\">Iowa page</a>." in t, "visible line")
        ok("—" not in t, "no em dash")
        y = open(os.path.join(d, "rain/maine/york-county.html")).read()
        ok('url=/rain"' in y, "no state page: points at the hub")
        m = load(d, "rain")
        ok(m["rain/iowa/story-county.html"] == {"to": "/rain/iowa", "since": "2026-10-18"}, f"manifest {m}")
        ok(is_pointer(os.path.join(d, "rain/iowa/story-county.html")), "is_pointer")
        ok(not is_pointer(os.path.join(d, "rain/iowa.html")), "a real page is not a pointer")
        ok(problems(d) == [], f"problems {problems(d)}")
        # a later run: nothing changes, the date holds
        ok(settle(d, "rain", ["rain/iowa/story-county.html", "rain/maine/york-county.html"], tf, today="2026-10-20") == [], "idempotent")
        ok(load(d, "rain")["rain/iowa/story-county.html"]["since"] == "2026-10-18", "since kept")
        ok(settle(d, "rain", ["rain/iowa/story-county.html", "rain/maine/york-county.html"], tf, check=True) == [], "check clean")
        # the state page leaves too: its county re-aims at the hub
        os.remove(os.path.join(d, "rain/iowa.html"))
        ok(settle(d, "rain", ["rain/iowa/story-county.html", "rain/maine/york-county.html"], tf, check=True)
           == ["rain/iowa/story-county.html", "data/pointers/rain.json"], "check sees the re-aim")
        settle(d, "rain", ["rain/iowa/story-county.html", "rain/maine/york-county.html"], tf)
        ok('url=/rain"' in open(os.path.join(d, "rain/iowa/story-county.html")).read(), "re-aimed at the hub")
        # York County comes back: the real page overwrites the pointer and the manifest drops it
        w("rain/maine/york-county.html", "<title>back</title>")
        settle(d, "rain", ["rain/iowa/story-county.html"], tf)
        ok("rain/maine/york-county.html" not in load(d, "rain"), "returned page leaves the manifest")
        ok(open(os.path.join(d, "rain/maine/york-county.html")).read() == "<title>back</title>", "real page kept")
        w("rain/iowa/story-county.html", page("/rain/ohio", "Story County", "Ohio"))
        ok(any("manifest says" in b for b in problems(d)), "mismatch caught")
        ok(any("not a real page" in b for b in problems(d)), "dead target caught")
    ok(label("yakutat-city-and-borough") == "Yakutat City and Borough", label("yakutat-city-and-borough"))
    ok(url_of("cash-bids/ohio/index.html") == "/cash-bids/ohio/" and url_of("rain/iowa.html") == "/rain/iowa", "url_of")
    if fails:
        print("SELFTEST FAIL")
        for f in fails:
            print("  -", f)
        return 1
    print("selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    bad = problems(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for b in bad:
        print("POINTER:", b)
    print(f"{len(load_all(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))} pointers, {len(bad)} problems")
    sys.exit(1 if bad else 0)
