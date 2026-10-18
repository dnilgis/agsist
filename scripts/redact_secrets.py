#!/usr/bin/env python3
"""Take anything that looks like a secret out of saved third-party pages.

2026-10-18. The elevator site captures (co-op home pages) carry the site
owners' own public-facing keys: Google Maps keys, Stripe publishable keys,
Mapbox tokens, now and then something worse. GitHub's push protection refuses
a push that contains them, so the raw-branch save failed, and land-data's raw
saves hit the same wall earlier. None of these strings is ours or needed by any
parser, so every raw save goes through here first (scripts/push_raw.sh runs it
on its staged copy) and the API job bundles are redacted when they are built.

  redact(text) -> (text, count)       the pure function
  python3 scripts/redact_secrets.py PATH [PATH ...]
                                      rewrite text files in place (folders
                                      recursively); binary files are skipped
  python3 scripts/redact_secrets.py selftest

Each match becomes "[redacted]". The patterns never contain a quote, a
backslash or a newline in what they replace, so a JSON file stays valid JSON.
"""
import math
import os
import re
import sys

MARK = "[redacted]"
T = r"A-Za-z0-9_\-"
PATTERNS = [
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----", re.S),
    re.compile(r"AIza[" + T + r"]{35,}"),                                 # Google API key
    re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}"),           # Stripe
    re.compile(r"\b(?:pk|sk|tk)\.eyJ[" + T + r"]{10,}\.[" + T + r"]{10,}"), # Mapbox
    re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b"),            # AWS access key id
    re.compile(r"\bxox[abposre]-[A-Za-z0-9\-]{10,}"),                       # Slack token
    re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/_\-]+"),     # Slack webhook
    re.compile(r"\beyJ[" + T + r"]{8,}\.eyJ[" + T + r"]{8,}\.[" + T + r"]{8,}"),  # JWT
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"),  # GitHub token
    re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}"),                              # GitLab token
    re.compile(r"\bSG\.[" + T + r"]{16,}\.[" + T + r"]{16,}"),             # SendGrid
    re.compile(r"\bsq0(?:atp|csp)-[" + T + r"]{20,}"),                     # Square
    re.compile(r"\b(?:AC|SK)[0-9a-f]{32}\b"),                               # Twilio
    re.compile(r"\bya29\.[" + T + r"]{20,}"),                               # Google OAuth access token
    re.compile(r"\b[0-9]+-[0-9a-z]{32}\.apps\.googleusercontent\.com"),     # Google OAuth client id
    re.compile(r"(?i)\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{20,}"),  # Azure
    re.compile(r"\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}"),                    # Shopify
    re.compile(r"\bnpm_[A-Za-z0-9]{36}"),                                   # npm
    re.compile(r"\bAKID[A-Za-z0-9]{13,}"),
]
# A long token right after a key-ish name: key=..., "apiKey":"...", token: '...'
GENERIC = re.compile(
    r"(?i)((?:api[_\-]?key|apikey|access[_\-]?key|secret(?:[_\-]?key)?|client[_\-]?(?:id|secret)|"
    r"(?:access|auth|bearer|refresh|id)?[_\-]?token|private[_\-]?key|password|passwd|\bkey|\bsig|signature)"
    r"\\*[\"']?\s*(?:=|:|%3D)\s*\\*[\"']?(?:Bearer\s+)?)([A-Za-z0-9_\-+/.~%]{20,})")


def entropy(s):
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in (s.count(x) for x in set(s))) if n else 0.0


def looks_random(s):
    core = re.sub(r"%[0-9A-Fa-f]{2}", "", s)
    if "/" in core and re.search(r"[a-z]{4,}/[a-z]{4,}", core):   # a path, not a key
        return False
    return (len(core) >= 20 and entropy(core) >= 3.6 and re.search(r"\d", core) is not None
            and re.search(r"[A-Za-z]", core) is not None)


def redact(text):
    n = 0
    for p in PATTERNS:
        text, k = p.subn(MARK, text)
        n += k

    def gen(m):
        nonlocal n
        if not looks_random(m.group(2)):
            return m.group(0)
        n += 1
        return m.group(1) + MARK
    text = GENERIC.sub(gen, text)
    return text, n


def is_text(path):
    try:
        with open(path, "rb") as f:
            head = f.read(8192)
    except OSError:
        return False
    return b"\0" not in head and not head.startswith((b"\x1f\x8b", b"%PDF", b"PK\x03\x04", b"\x89PNG"))


def redact_file(path):
    if not is_text(path):
        return 0
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        s = f.read()
    out, n = redact(s)
    if n:
        with open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
            f.write(out)
    return n


def redact_paths(paths):
    total, files = 0, 0
    for p in paths:
        walk = [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs] if os.path.isdir(p) else [p]
        for f in walk:
            if os.path.islink(f) or not os.path.isfile(f):
                continue
            k = redact_file(f)
            if k:
                total += k; files += 1
    return total, files


def selftest():
    j = "".join
    google = j(["AI", "za", "Sy", "B" * 10, "x1Y2z3" * 5, "Q"])          # 39 chars
    stripe = j(["pk", "_live_", "51Hc", "Ab12Cd34Ef56Gh78"])
    stripe2 = j(["sk", "_test_", "4eC39Hq", "LyjWDarjtT1zdp7dc"])
    mapbox = j(["pk", ".eyJ", "1IjoiY29vcCIsImEiOiJjbGZ4In0", ".", "aBcD3fGh1jKlMn0pQrStUv"])
    aws = j(["AK", "IA", "IOSFODNN7", "EXAMPLE"])
    slack = j(["xo", "xb-", "1234567890", "-abcdefABCDEF12"])
    jwt = j(["ey", "JhbGciOiJIUzI1NiJ9", ".", "ey", "JzdWIiOiIxMjM0NTY3ODkwIn0", ".", "SflKxwRJSMeKKF2QT4fwpM"])
    pem = j(["-----BEGIN ", "RSA PRIVATE KEY-----\\nMIIEow", "IBAAKCAQEA\\n-----END ", "RSA PRIVATE KEY-----"])
    generic = j(["9f8a7b6c5d4e", "3f2a1b0c9d8e7f6a"])
    page = (f'<script src="https://maps.googleapis.com/maps/api/js?key={google}&callback=init"></script>'
            f'{{"stripe": "{stripe}", "s2": "{stripe2}", "mb": "{mapbox}", "aws": "{aws}", "sl": "{slack}", "jwt": "{jwt}",'
            f' "pem": "{pem}", "cfg": "{{\\"apiKey\\":\\"{generic}\\"}}", "url": "https://x.com/a?token={generic}"}}'
            ' Corn 3.85 Hubbard | https://www.coop.com/grain/cash-bids/index.php?key=cashbids'
            ' "client_id": "my-very-readable-client-name"')
    out, n = redact(page)
    for secret in (google, stripe, stripe2, mapbox, aws, slack, jwt, generic, "MIIEow"):
        assert secret not in out, secret
    assert n >= 10, (n, out)
    assert "Corn 3.85 Hubbard" in out and "key=cashbids" in out and "my-very-readable-client-name" in out, out
    assert "maps/api/js?key=[redacted]&callback=init" in out, out
    import json
    blob = json.dumps({"text": page, "n": [1, 2]})
    out2, _ = redact(blob)
    assert json.loads(out2)["n"] == [1, 2] and google not in out2 and generic not in out2
    assert redact("nothing to see, corn 3.85, wheat 5.10")[1] == 0
    print("redact selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    else:
        t, f = redact_paths(a)
        print(f"redact: {t} secret-looking string(s) replaced in {f} file(s)")
