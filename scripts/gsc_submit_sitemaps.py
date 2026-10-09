#!/usr/bin/env python3
"""
gsc_submit_sitemaps.py - tell Google Search Console about every sitemap.

Google retired its sitemap ping endpoint in 2023, so the only way to tell it
a sitemap changed is the Search Console API (webmasters v3):

    PUT https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}

This reads every "Sitemap:" line in robots.txt, submits each one, then lists
the property's sitemaps and prints lastSubmitted / lastDownloaded / errors /
warnings per sitemap, so the Actions log shows what Google has.

Auth: a service account JSON in the env var GSC_SERVICE_ACCOUNT_JSON (the repo
secret of the same name). The service account's email must be added as an
Owner (or Full user) of the Search Console property. The key is never
printed. No secret: one notice line and exit 0, so the job stays green until
the secret is set.

Property: GSC_SITE (default "sc-domain:agsist.com"). If Google answers 403 or
404 for it, "https://agsist.com/" is tried next, and the log says which one
worked.

    python3 scripts/gsc_submit_sitemaps.py             # submit + status
    python3 scripts/gsc_submit_sitemaps.py --selftest  # offline, fake transport
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
API = "https://www.googleapis.com/webmasters/v3"
SCOPE = "https://www.googleapis.com/auth/webmasters"
DEFAULT_SITE = "sc-domain:agsist.com"
FALLBACK_SITE = "https://agsist.com/"
SECRET_ENV = "GSC_SERVICE_ACCOUNT_JSON"


def robots_sitemaps(root=REPO):
    out = []
    robots = Path(root) / "robots.txt"
    if robots.is_file():
        for line in robots.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*sitemap\s*:\s*(\S+)", line, re.I)
            if m and m.group(1) not in out:
                out.append(m.group(1))
    return out


def site_candidates(env_site=None):
    out = []
    for s in (env_site or DEFAULT_SITE, DEFAULT_SITE, FALLBACK_SITE):
        if s and s not in out:
            out.append(s)
    return out


def q(s):
    return urllib.parse.quote(s, safe="")


class UrllibTransport:
    """(method, url, token) -> (status, body text). Never logs the token."""

    def __call__(self, method, url, token):
        req = urllib.request.Request(url, method=method, data=b"" if method == "PUT" else None,
                                     headers={"Authorization": f"Bearer {token}",
                                              "User-Agent": "AGSIST-GSC-Sitemaps/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
        except urllib.error.URLError as e:
            return 0, f"network error: {e.reason}"


def access_token(info):
    """OAuth token for the service account (google-auth). Raises on bad key."""
    from google.oauth2 import service_account
    import google.auth.transport.requests
    creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _err_text(body):
    """Google's error message only, short: never echoes request headers."""
    try:
        return json.loads(body)["error"]["message"][:200]
    except Exception:
        return (body or "").strip()[:200]


def run(sitemaps, token, transport, env_site=None, log=print):
    """Submit each sitemap, then list status. Returns exit code."""
    if not sitemaps:
        log("[gsc] robots.txt lists no sitemaps; nothing to do")
        return 0
    site = None
    for cand in site_candidates(env_site):
        st, body = transport("PUT", f"{API}/sites/{q(cand)}/sitemaps/{q(sitemaps[0])}", token)
        if st in (200, 204):
            site = cand
            log(f"[gsc] property {cand}: accepted")
            log(f"[gsc] submitted {sitemaps[0]}")
            break
        log(f"[gsc] property {cand}: HTTP {st} {_err_text(body)}")
        if st not in (403, 404):
            return 1
    if site is None:
        log("[gsc] no property accepted the service account. Add its email as an Owner "
            "of the Search Console property, or set GSC_SITE.")
        return 1
    bad = 0
    for sm in sitemaps[1:]:
        st, body = transport("PUT", f"{API}/sites/{q(site)}/sitemaps/{q(sm)}", token)
        if st in (200, 204):
            log(f"[gsc] submitted {sm}")
        else:
            bad += 1
            log(f"[gsc] FAILED {sm}: HTTP {st} {_err_text(body)}")
    st, body = transport("GET", f"{API}/sites/{q(site)}/sitemaps", token)
    if st == 200:
        try:
            rows = json.loads(body or "{}").get("sitemap") or []
        except ValueError:
            rows = []
        log(f"[gsc] status for {site} ({len(rows)} sitemap(s)):")
        for r in sorted(rows, key=lambda r: r.get("path", "")):
            log(f"  {r.get('path')}  lastSubmitted={r.get('lastSubmitted', 'none')}  "
                f"lastDownloaded={r.get('lastDownloaded', 'none')}  "
                f"pending={r.get('isPending', False)}  errors={r.get('errors', 0)}  "
                f"warnings={r.get('warnings', 0)}")
    else:
        log(f"[gsc] list failed: HTTP {st} {_err_text(body)}")
    return 1 if bad else 0


def main():
    raw = os.environ.get(SECRET_ENV, "").strip()
    if not raw:
        print(f"[gsc] {SECRET_ENV} is not set; skipping Search Console sitemap submit.")
        return 0
    try:
        info = json.loads(raw)
    except ValueError:
        print(f"[gsc] {SECRET_ENV} is not valid JSON (contents not shown).")
        return 1
    print(f"[gsc] service account: {info.get('client_email', '(no client_email)')}")
    try:
        token = access_token(info)
    except Exception as e:  # message may quote the key file; print the type only
        print(f"[gsc] could not get an access token ({type(e).__name__}).")
        return 1
    return run(robots_sitemaps(), token, UrllibTransport(), os.environ.get("GSC_SITE"))


# ---------------------------------------------------------------- selftest
def selftest():
    failed = []

    def check(ok, name, detail=""):
        print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  :: " + str(detail)))
        if not ok:
            failed.append(name)

    class Fake:
        def __init__(self, ok_site, list_body=None, fail=()):
            self.ok_site, self.calls, self.fail = ok_site, [], set(fail)
            self.list_body = list_body or json.dumps({"sitemap": [
                {"path": "https://agsist.com/sitemap.xml", "lastSubmitted": "2026-10-09T12:00:00Z",
                 "errors": "0", "warnings": "2"}]})

        def __call__(self, method, url, token):
            self.calls.append((method, url, token))
            site = urllib.parse.unquote(url.split("/sites/")[1].split("/")[0])
            if site != self.ok_site:
                return 403, json.dumps({"error": {"message": "User does not have sufficient permission"}})
            if method == "GET":
                return 200, self.list_body
            if any(f in urllib.parse.unquote(url) for f in self.fail):
                return 500, "{}"
            return 204, ""

    sms = ["https://agsist.com/sitemap.xml", "https://agsist.com/sitemap-arc-plc.xml"]
    logs = []
    f = Fake("sc-domain:agsist.com")
    rc = run(sms, "TOKEN123", f, None, logs.append)
    puts = [c for c in f.calls if c[0] == "PUT"]
    check(rc == 0, "domain property: exit 0", logs)
    check(len(puts) == 2, "one PUT per sitemap", puts)
    check(puts[0][1] == f"{API}/sites/sc-domain%3Aagsist.com/sitemaps/https%3A%2F%2Fagsist.com%2Fsitemap.xml",
          "URL encodes siteUrl and feedpath", puts[0][1])
    check(any("errors=0" in l and "warnings=2" in l and "lastSubmitted=2026-10-09" in l for l in logs),
          "list printed with lastSubmitted/errors/warnings", logs)
    check(not any("TOKEN123" in l for l in logs), "token never logged")

    logs = []
    f = Fake("https://agsist.com/")
    rc = run(sms, "T", f, None, logs.append)
    check(rc == 0 and any("https://agsist.com/: accepted" in l for l in logs), "403 falls back to URL-prefix property", logs)

    logs = []
    rc = run(sms, "T", Fake("sc-domain:other.com"), None, logs.append)
    check(rc == 1, "no property works: exit 1", logs)

    logs = []
    rc = run(sms, "T", Fake("sc-domain:agsist.com", fail=["sitemap-arc-plc"]), None, logs.append)
    check(rc == 1 and any("FAILED https://agsist.com/sitemap-arc-plc.xml" in l for l in logs), "a failed sitemap turns the run red")

    check(site_candidates("https://agsist.com/") == ["https://agsist.com/", "sc-domain:agsist.com"],
          "GSC_SITE tried first, then the default")
    check(any(s.endswith("sitemap-arc-plc.xml") for s in robots_sitemaps()), "repo robots.txt sitemaps read")

    saved = os.environ.pop(SECRET_ENV, None)
    try:
        check(main() == 0, "missing secret: exit 0")
    finally:
        if saved is not None:
            os.environ[SECRET_ENV] = saved

    if failed:
        print(f"\n{len(failed)} failed")
        return 1
    print("\nall gsc sitemap checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else main())
