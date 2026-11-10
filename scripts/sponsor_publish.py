#!/usr/bin/env python3
"""
SPONSOR LINKS AND REPORTS, KEPT PRIVATE (Nov 4, 2026).

Until Nov 4 every sponsor's link token sat in data/sponsors.json and in the
report file names under data/sponsors/, so the public repo and agsist.com
handed out every sponsor's numbers. Now:

  * the tokens live only in the private repo, branch private-data, one file per
    sponsor: private/sponsors/tokens/<slug>.json {slug, token, retired, minted};
  * the reports are built into private/sponsors/reports/<slug>.json (no token in
    the name) by scripts/build_sponsor_report.py, saved to private-data, and
    posted to the subs worker (POST /sponsor-report/put, Bearer LIST_TOKEN);
  * the portal asks the worker: GET /sponsor-report?r=<slug>-<token>
    (workers/subs-worker.js v5.65). A retired token answers "this link has
    changed"; it is never sent on to the new one;
  * the links to hand a sponsor are written to private/sponsors/links.json,
    each with its approval key k (hmac16 of "sponsor-portal|" + r under
    UNSUB_SECRET, as the worker checks it). Nothing else prints a token.

private/ is in .gitignore on main, so a copy unpacked into a checkout is never
committed there (scripts/pull_raw.sh, scripts/push_raw.sh, RAW_BRANCH=private-data).

    python3 scripts/sponsor_publish.py mint             a token for every sponsor without one (never replaces one)
    python3 scripts/sponsor_publish.py rotate <slug>    a new token; the old one is retired
    python3 scripts/sponsor_publish.py rotate --all
    python3 scripts/sponsor_publish.py publish          reports to the worker, links.json written
    python3 scripts/sponsor_publish.py --selftest

SPONSOR_PRIVATE_DIR overrides the folder (default <repo>/private/sponsors).
Every line printed names slugs and counts only, never a token or a link. In Actions the
first lines are ::add-mask:: for every token, so the runner blanks them from the log.

THE FIRST TOKEN WINS. Two jobs can mint for the same new sponsor at once (sponsor-apply.yml and
sponsor-report.yml). Both save with RAW_KEEP=1 (scripts/push_raw.sh: a file already on the
branch is never replaced) and then pull the tokens back, so each adopts whichever landed first.
Only a hand rotation replaces a live token (push without RAW_KEEP).
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONF = ROOT / "data" / "sponsors.json"
SITE = "https://agsist.com"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
TOKEN_RE = re.compile(r"^[0-9a-f]{16,64}$")
# A made-up token in a test or fixture: one character repeated, or the plain run.
# scripts/sponsor_publish.py's public check and test/sponsor-private.test.mjs allow
# only these in the public tree.
FAKE_RE = re.compile(r"^(?:(.)\1{15}|0123456789abcdef|000000000000000\d)$")


def mask(tokens, out=None):
    """In Actions, tell the runner to blank every live and retired token from the log before anything
    else is printed (::add-mask::). Outside Actions nothing is printed: the line itself carries the token."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return 0
    out = out or sys.stdout
    pats = sorted({t for rec in tokens.values() for t in [rec["token"]] + rec["retired"]})
    for t in pats:
        out.write("::add-mask::%s\n" % t)
    out.flush()
    return len(pats)


def private_dir():
    return Path(os.environ.get("SPONSOR_PRIVATE_DIR") or (ROOT / "private" / "sponsors"))


def reports_dir(d=None):
    return (d or private_dir()) / "reports"


def load_conf(path=CONF):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def conf_slugs(conf):
    return [s["slug"] for s in conf.get("sponsors", []) if SLUG_RE.match(str(s.get("slug") or ""))]


def load_tokens(d=None):
    """{slug: {"token": ..., "retired": [...]}} from tokens/<slug>.json. A malformed file is an error."""
    out = {}
    t = (d or private_dir()) / "tokens"
    if not t.is_dir():
        return out
    for f in sorted(t.glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        slug, tok = rec.get("slug"), rec.get("token")
        if slug != f.stem or not SLUG_RE.match(str(slug)) or not TOKEN_RE.match(str(tok or "")):
            raise ValueError("%s: needs slug equal to the file name and a 16 to 64 hex token" % f.name)
        ret = [x for x in rec.get("retired") or []]
        if any(not TOKEN_RE.match(str(x)) for x in ret) or tok in ret:
            raise ValueError("%s: retired tokens must be hex and never the live one" % f.name)
        out[slug] = {"token": tok, "retired": ret}
    return out


def _write_token(d, slug, rec):
    t = d / "tokens"
    t.mkdir(parents=True, exist_ok=True)
    (t / ("%s.json" % slug)).write_text(json.dumps(dict(slug=slug, **rec), indent=1) + "\n", encoding="utf-8")


def mint(slug, d=None, rotate=False, today=None):
    """A token for slug. Keeps an existing one unless rotate; a rotated token is retired, never deleted."""
    if not SLUG_RE.match(str(slug or "")):
        raise ValueError("bad slug")
    d = d or private_dir()
    have = load_tokens(d).get(slug)
    if have and not rotate:
        return have["token"]   # idempotent: a live token is never replaced except by rotate
    rec = {"token": secrets.token_hex(8), "retired": [], "minted": (today or date.today()).isoformat()}
    mask({slug: {"token": rec["token"], "retired": []}})
    if have:
        rec["retired"] = (have["retired"] + [have["token"]])[-20:]
    _write_token(d, slug, rec)
    return rec["token"]


def ensure_tokens(conf, d=None):
    """Mint a token for every sponsor in data/sponsors.json that has none. Returns the slugs minted."""
    d = d or private_dir()
    have = load_tokens(d)
    out = []
    for slug in conf_slugs(conf):
        if slug not in have:
            mint(slug, d)
            out.append(slug)
    return out


def sign(r, secret):
    """k for a portal link: hmac16("sponsor-portal|" + r) under UNSUB_SECRET, as the worker's sponsorKey()."""
    return hmac.new(secret.encode(), ("sponsor-portal|" + r).lower().encode(), hashlib.sha256).hexdigest()[:16]


def link(slug, token, secret=None):
    r = "%s-%s" % (slug, token)
    return "%s/sponsor-report?r=%s%s" % (SITE, r, ("&k=" + sign(r, secret)) if secret else "")


def portal_link(slug, d=None, secret=None):
    """The link for one sponsor, or None when no token is on file."""
    rec = load_tokens(d).get(slug)
    return link(slug, rec["token"], secret) if rec else None


def write_links(conf, d=None, secret=None):
    d = d or private_dir()
    toks = load_tokens(d)
    out = {"note": "Private. Each sponsor's own report link, to send to that sponsor only. "
                   "k is the approval key; a link without it still opens the page.",
           "signed": bool(secret), "links": {}}
    for slug in conf_slugs(conf):
        if slug in toks:
            out["links"][slug] = link(slug, toks[slug]["token"], secret)
    (d / "links.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return len(out["links"])


def public_hits(tokens, root=ROOT):
    """Tracked files in the public checkout that contain any live or retired token (git grep -F).
    Names files only; never the token."""
    pats = sorted({t for rec in tokens.values() for t in [rec["token"]] + rec["retired"]})
    if not pats:
        return []
    args = ["git", "-C", str(root), "grep", "-l", "-I", "-F"]
    for p in pats:
        args += ["-e", p]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode not in (0, 1):
        raise RuntimeError("git grep failed")
    return [x for x in r.stdout.splitlines() if x]


def _call(base, path, tok, body=None, opener=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method="POST" if data is not None else "GET",
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json",
                                          "User-Agent": "agsist-sponsor-publish"})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except ValueError:
            return {"ok": False, "error": "HTTP %d" % e.code}


def publish(conf, base, tok, d=None, opener=None):
    """Every report on file goes to the worker with its token and retired tokens.
    A slug the worker holds that data/sponsors.json no longer lists is dropped there.
    Returns (sent, dropped, problems)."""
    d = d or private_dir()
    toks = load_tokens(d)
    sent, problems = [], []
    slugs = conf_slugs(conf)
    for slug in slugs:
        f = reports_dir(d) / ("%s.json" % slug)
        if slug not in toks:
            problems.append("%s: no token on file" % slug)
            continue
        if not f.exists():
            problems.append("%s: no report built yet" % slug)
            continue
        report = json.loads(f.read_text(encoding="utf-8"))
        a = _call(base, "/sponsor-report/put", tok, {"slug": slug, "token": toks[slug]["token"],
                                                    "retired": toks[slug]["retired"], "report": report}, opener)
        if not a.get("ok"):
            problems.append("%s: the worker refused it (%s)" % (slug, str(a.get("error") or "no reason")[:80]))
            continue
        sent.append(slug)
    dropped = []
    held = _call(base, "/sponsor-report/list", tok, None, opener).get("reports") or []
    for x in held:
        if x.get("slug") not in slugs:
            _call(base, "/sponsor-report/drop", tok, {"slug": x["slug"]}, opener)
            dropped.append(x["slug"])
    return sent, dropped, problems


# ───────────────────────────── selftest ─────────────────────────────

def selftest():
    import io
    import tempfile
    fails = []

    def check(ok, what):
        if not ok:
            fails.append(what)
        print(("  ok   " if ok else "  FAIL ") + what)

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "sponsors"
        conf = {"sponsors": [{"slug": "barnco"}, {"slug": "seedco"}, {"slug": "Bad Slug"}]}
        check(ensure_tokens(conf, d) == ["barnco", "seedco"], "mint: a token for each listed sponsor, a bad slug skipped")
        toks = load_tokens(d)
        check(all(TOKEN_RE.match(v["token"]) and len(v["token"]) == 16 for v in toks.values()), "mint: 16 hex characters")
        check(ensure_tokens(conf, d) == [] and load_tokens(d) == toks, "mint: a sponsor with a token keeps it")
        old = toks["barnco"]["token"]
        new = mint("barnco", d, rotate=True)
        t2 = load_tokens(d)["barnco"]
        check(new != old and t2["token"] == new and t2["retired"] == [old], "rotate: new token, the old one retired")
        check(not FAKE_RE.match(new), "a minted token is never one of the made-up test patterns")
        check(FAKE_RE.match("0000000000000000") and FAKE_RE.match("0123456789abcdef") and not FAKE_RE.match("9c4e1b7a33d0f852"),
              "made-up token patterns are recognised")
        # k matches the worker's own formula (python one-liner in the worker header)
        check(sign("apex-0000000000000001", "sec") == hmac.new(b"sec", b"sponsor-portal|apex-0000000000000001", hashlib.sha256).hexdigest()[:16],
              "k is hmac16 of sponsor-portal|r under the secret")
        lk = portal_link("barnco", d, "sec")
        check(lk.startswith(SITE + "/sponsor-report?r=barnco-" + new + "&k=") and portal_link("nobody", d) is None, "portal link: r and k")
        n = write_links(conf, d, "sec")
        lj = json.loads((d / "links.json").read_text())
        check(n == 2 and lj["signed"] and set(lj["links"]) == {"barnco", "seedco"}, "links.json: one signed link per sponsor")
        # a malformed token file is an error, not a silent skip
        (d / "tokens" / "zzz.json").write_text(json.dumps({"slug": "other", "token": "abc"}))
        try:
            load_tokens(d)
            check(False, "a malformed token file is refused")
        except ValueError:
            check(True, "a malformed token file is refused")
        (d / "tokens" / "zzz.json").unlink()

        # publish against a fake worker
        reports_dir(d).mkdir(parents=True, exist_ok=True)
        (reports_dir(d) / "barnco.json").write_text(json.dumps({"schema": "agsist-sponsor-report/1", "slug": "barnco"}))
        calls, held = [], [{"slug": "barnco"}, {"slug": "gone"}]

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def opener(req, timeout=None):
            body = json.loads(req.data.decode()) if req.data else None
            calls.append((req.get_method(), req.full_url, req.get_header("Authorization"), body))
            if req.full_url.endswith("/list"):
                return Resp(json.dumps({"ok": True, "reports": held}).encode())
            return Resp(json.dumps({"ok": True}).encode())

        sent, dropped, problems = publish(conf, "https://w.test", "tok", d, opener)
        put = [c for c in calls if c[1].endswith("/put")]
        check(sent == ["barnco"] and dropped == ["gone"], "publish: the report sent, a slug no longer listed dropped")
        check(problems == ["seedco: no report built yet"], "publish: a sponsor with no report is reported, not sent")
        check(put and put[0][2] == "Bearer tok" and put[0][3]["token"] == new and put[0][3]["retired"] == [old]
              and put[0][3]["report"]["slug"] == "barnco", "publish: Bearer, live token, retired tokens and the report")
        check(all("token=" not in c[1] for c in calls), "publish: never a token in a URL")

    # ::add-mask:: for every live and retired token, in Actions only, and for a token as it is minted
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        _write_token(d, "barnco", {"token": "1" * 16, "retired": ["2" * 16, "3" * 16]})
        buf = io.StringIO()
        old_env = os.environ.get("GITHUB_ACTIONS")
        try:
            os.environ["GITHUB_ACTIONS"] = "true"
            n = mask(load_tokens(d), buf)
            check(n == 3 and buf.getvalue().splitlines() == ["::add-mask::" + "1" * 16, "::add-mask::" + "2" * 16, "::add-mask::" + "3" * 16],
                  "mask: every live and retired token, in Actions")
            real = sys.stdout
            sys.stdout = cap = io.StringIO()
            try:
                t = mint("seedco", d)
            finally:
                sys.stdout = real
            check(cap.getvalue() == "::add-mask::%s\n" % t, "mask: a new token is masked as it is minted, before anything else")
            os.environ["GITHUB_ACTIONS"] = "false"
            buf2 = io.StringIO()
            check(mask(load_tokens(d), buf2) == 0 and buf2.getvalue() == "", "mask: nothing printed outside Actions")
        finally:
            if old_env is None:
                os.environ.pop("GITHUB_ACTIONS", None)
            else:
                os.environ["GITHUB_ACTIONS"] = old_env

    # the public tree check finds a planted token and names only the file
    # made up at run time: a real-looking token typed into this file would sit in the public tree
    planted, other, other2 = secrets.token_hex(8), secrets.token_hex(8), secrets.token_hex(8)
    with tempfile.TemporaryDirectory() as tmp:
        r = Path(tmp)
        subprocess.run(["git", "init", "-q", str(r)], check=True)
        (r / "a.txt").write_text("nothing here\n")
        (r / "b.txt").write_text("see token %s here\n" % planted)
        subprocess.run(["git", "-C", str(r), "add", "."], check=True)
        hits = public_hits({"x": {"token": planted, "retired": []}}, r)
        check(hits == ["b.txt"], "public check: a planted token is found, by file name")
        check(public_hits({"x": {"token": other, "retired": [other2]}}, r) == [], "public check: a clean tree passes")

    print("sponsor_publish selftest: %d failed" % len(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    cmd = argv[1] if len(argv) > 1 else ""
    conf = load_conf()
    d = private_dir()
    mask(load_tokens(d))   # first, before any other line (Actions only)
    if cmd == "mint":
        m = ensure_tokens(conf, d)
        print("tokens minted for %d sponsor(s): %s" % (len(m), ", ".join(m) or "none"))
        return 0
    if cmd == "rotate":
        which = conf_slugs(conf) if "--all" in argv else [a for a in argv[2:] if not a.startswith("-")]
        if not which:
            print("rotate: name a slug or --all")
            return 2
        for slug in which:
            mint(slug, d, rotate=True)
        print("rotated %d token(s): %s" % (len(which), ", ".join(which)))
        return 0
    if cmd == "publish":
        toks = load_tokens(d)
        hits = public_hits(toks)
        if hits:
            print("::error::a sponsor token is in %d public file(s): %s. Nothing published; "
                  "rotate every token (python3 scripts/sponsor_publish.py rotate --all) and remove it."
                  % (len(hits), ", ".join(hits[:10])))
            return 1
        n = write_links(conf, d, os.environ.get("UNSUB_SECRET") or None)
        print("links.json: %d link(s)%s" % (n, "" if os.environ.get("UNSUB_SECRET") else " (unsigned: UNSUB_SECRET not set)"))
        base, tok = (os.environ.get("LIST_URL") or "").rstrip("/"), os.environ.get("LIST_TOKEN") or ""
        if not (base and tok):
            print("::warning::LIST_URL or LIST_TOKEN is not set; the reports were not sent to the worker")
            return 0
        sent, dropped, problems = publish(conf, base, tok, d)
        print("sent %d report(s): %s; dropped %d" % (len(sent), ", ".join(sent) or "none", len(dropped)))
        for p in problems:
            print("::warning::" + p)
        # A report the worker refused is a sponsor whose page shows old numbers or none: a red run.
        # A sponsor with no report built yet (new today, or never run) is only a warning.
        return 1 if any("refused" in p for p in problems) else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
